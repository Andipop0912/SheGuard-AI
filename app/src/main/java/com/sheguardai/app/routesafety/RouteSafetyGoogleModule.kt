package com.sheguardai.app.routesafety

import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.sheguardai.app.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Native-only bridge to Google's Routes API (New) and Places API (New).
 *
 * The Maps/Places/Routes API key is Android-app-restricted (package + SHA-1 cert) and, per this
 * codebase's existing convention (see AppConfigModule / mapsConfig.ts), never reaches JavaScript.
 * These REST calls therefore happen here in Kotlin, with the Android-restriction headers Google
 * requires for server-style REST calls from a key that is restricted to this Android app.
 */
class RouteSafetyGoogleModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardRouteSafety"
        private const val ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
        private const val PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby"
        private const val TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
        private const val MAX_PLACES = 20
    }

    private val executor = Executors.newCachedThreadPool()

    override fun getName(): String = "SheGuardRouteSafetyModule"

    private fun androidCertFingerprint(): String? {
        return try {
            val pm = reactApplicationContext.packageManager
            val packageName = reactApplicationContext.packageName
            val signatureBytes: ByteArray? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // GET_SIGNATURES returns an empty array on API 28+ for apps signed with APK
                // Signature Scheme v2/v3 (the default) — this is the path that actually works.
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                info.signingInfo?.let { signingInfo ->
                    if (signingInfo.hasMultipleSigners()) {
                        signingInfo.apkContentsSigners?.firstOrNull()?.toByteArray()
                    } else {
                        signingInfo.signingCertificateHistory?.firstOrNull()?.toByteArray()
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                info.signatures?.firstOrNull()?.toByteArray()
            }
            if (signatureBytes == null) {
                Log.e(TAG, "No signing certificate found for Android-restricted API headers")
                return null
            }
            val digest = MessageDigest.getInstance("SHA-1").digest(signatureBytes)
            val fingerprint = digest.joinToString(":") { String.format("%02X", it) }
            Log.i(TAG, "Computed Android signing cert SHA-1 for API restriction headers: $fingerprint")
            fingerprint
        } catch (e: Exception) {
            Log.e(TAG, "Could not read signing certificate for Android-restricted API headers", e)
            null
        }
    }

    private fun postJson(urlString: String, fieldMask: String, body: JSONObject): JSONObject {
        val connection = URL(urlString).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("X-Goog-Api-Key", BuildConfig.GOOGLE_MAPS_API_KEY)
            connection.setRequestProperty("X-Goog-FieldMask", fieldMask)
            connection.setRequestProperty("X-Android-Package", reactApplicationContext.packageName)
            androidCertFingerprint()?.let { connection.setRequestProperty("X-Android-Cert", it) }

            connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            if (code !in 200..299) {
                Log.w(TAG, "Google API call to $urlString failed with HTTP $code: $text")
                throw RuntimeException("Google API error (HTTP $code)")
            }
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Returns { distanceMeters, durationSeconds, polyline: [{latitude,longitude}, ...] } or
     * rejects — the caller (RouteSafetyController) never silently fabricates a route.
     */
    @ReactMethod
    fun computeRoute(originLat: Double, originLng: Double, destLat: Double, destLng: Double, promise: Promise) {
        executor.execute {
            try {
                if (BuildConfig.GOOGLE_MAPS_API_KEY.isEmpty()) {
                    promise.reject("NOT_CONFIGURED", "Google Maps API key is not configured in this build")
                    return@execute
                }
                val body = JSONObject().apply {
                    put("origin", JSONObject().put("location", JSONObject().put("latLng", JSONObject().put("latitude", originLat).put("longitude", originLng))))
                    put("destination", JSONObject().put("location", JSONObject().put("latLng", JSONObject().put("latitude", destLat).put("longitude", destLng))))
                    put("travelMode", "WALK")
                    put("polylineQuality", "OVERVIEW")
                }
                val json = postJson(ROUTES_URL, "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline", body)
                val routes = json.optJSONArray("routes")
                if (routes == null || routes.length() == 0) {
                    promise.reject("NO_ROUTE", "Google Routes API returned no route")
                    return@execute
                }
                val route = routes.getJSONObject(0)
                val distanceMeters = route.optDouble("distanceMeters", Double.NaN)
                val durationSeconds = parseDurationSeconds(route.optString("duration", null))
                val encoded = route.optJSONObject("polyline")?.optString("encodedPolyline")
                val points = if (encoded != null) decodePolyline(encoded) else emptyList()

                val result: WritableMap = Arguments.createMap()
                if (!distanceMeters.isNaN()) result.putDouble("distanceMeters", distanceMeters)
                if (durationSeconds != null) result.putInt("durationSeconds", durationSeconds)
                val polylineArray: WritableArray = Arguments.createArray()
                points.forEach { (lat, lng) ->
                    val point: WritableMap = Arguments.createMap()
                    point.putDouble("latitude", lat)
                    point.putDouble("longitude", lng)
                    polylineArray.pushMap(point)
                }
                result.putArray("polyline", polylineArray)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("ROUTE_COMPUTE_FAILED", e.message, e)
            }
        }
    }

    /**
     * Resolves free-text (an address or a place name) to coordinates, biased near the device's
     * current location, using Places API (New) Text Search. Never fabricates a destination:
     * no match rejects the promise.
     */
    @ReactMethod
    fun geocodeText(query: String, biasLat: Double, biasLng: Double, promise: Promise) {
        executor.execute {
            try {
                if (BuildConfig.GOOGLE_MAPS_API_KEY.isEmpty()) {
                    promise.reject("NOT_CONFIGURED", "Google Maps API key is not configured in this build")
                    return@execute
                }
                val body = JSONObject().apply {
                    put("textQuery", query)
                    put(
                        "locationBias",
                        JSONObject().put(
                            "circle",
                            JSONObject()
                                .put("center", JSONObject().put("latitude", biasLat).put("longitude", biasLng))
                                .put("radius", 50_000.0)
                        )
                    )
                    put("maxResultCount", 1)
                }
                val json = postJson(TEXT_SEARCH_URL, "places.displayName,places.formattedAddress,places.location", body)
                val places = json.optJSONArray("places")
                if (places == null || places.length() == 0) {
                    promise.reject("NOT_FOUND", "No place matched '$query'")
                    return@execute
                }
                val place = places.getJSONObject(0)
                val location = place.optJSONObject("location")
                if (location == null) {
                    promise.reject("NOT_FOUND", "Place had no coordinates")
                    return@execute
                }
                val result: WritableMap = Arguments.createMap()
                result.putDouble("latitude", location.optDouble("latitude"))
                result.putDouble("longitude", location.optDouble("longitude"))
                result.putString("formattedAddress", place.optString("formattedAddress", query))
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("GEOCODE_FAILED", e.message, e)
            }
        }
    }

    /** `placeType` is a Google Places (New) type, e.g. "hospital", "police", "fire_station". */
    @ReactMethod
    fun searchNearbyPlaces(latitude: Double, longitude: Double, radiusMeters: Double, placeType: String, promise: Promise) {
        executor.execute {
            try {
                if (BuildConfig.GOOGLE_MAPS_API_KEY.isEmpty()) {
                    promise.reject("NOT_CONFIGURED", "Google Maps API key is not configured in this build")
                    return@execute
                }
                val body = JSONObject().apply {
                    put("includedTypes", JSONArray().put(placeType))
                    put("maxResultCount", MAX_PLACES)
                    put(
                        "locationRestriction",
                        JSONObject().put(
                            "circle",
                            JSONObject()
                                .put("center", JSONObject().put("latitude", latitude).put("longitude", longitude))
                                .put("radius", radiusMeters)
                        )
                    )
                }
                val fieldMask = "places.displayName,places.formattedAddress,places.location,places.id"
                val json = postJson(PLACES_URL, fieldMask, body)
                val places = json.optJSONArray("places") ?: JSONArray()

                val result: WritableArray = Arguments.createArray()
                for (i in 0 until places.length()) {
                    val place = places.getJSONObject(i)
                    val location = place.optJSONObject("location")
                    val item: WritableMap = Arguments.createMap()
                    item.putString("placeId", place.optString("id", ""))
                    item.putString("name", place.optJSONObject("displayName")?.optString("text") ?: "")
                    item.putString("address", place.optString("formattedAddress", ""))
                    item.putDouble("latitude", location?.optDouble("latitude") ?: 0.0)
                    item.putDouble("longitude", location?.optDouble("longitude") ?: 0.0)
                    result.pushMap(item)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("PLACES_SEARCH_FAILED", e.message, e)
            }
        }
    }

    private fun parseDurationSeconds(duration: String?): Int? {
        // Google returns durations like "123s".
        if (duration == null || !duration.endsWith("s")) return null
        return duration.dropLast(1).toDoubleOrNull()?.toInt()
    }

    /** Decodes a Google-encoded polyline into a list of (latitude, longitude) pairs. */
    private fun decodePolyline(encoded: String): List<Pair<Double, Double>> {
        val points = mutableListOf<Pair<Double, Double>>()
        var index = 0
        var lat = 0
        var lng = 0
        while (index < encoded.length) {
            var shift = 0
            var result = 0
            var b: Int
            do {
                b = encoded[index++].code - 63
                result = result or ((b and 0x1f) shl shift)
                shift += 5
            } while (b >= 0x20)
            val deltaLat = if (result and 1 != 0) (result shr 1).inv() else (result shr 1)
            lat += deltaLat

            shift = 0
            result = 0
            do {
                b = encoded[index++].code - 63
                result = result or ((b and 0x1f) shl shift)
                shift += 5
            } while (b >= 0x20)
            val deltaLng = if (result and 1 != 0) (result shr 1).inv() else (result shr 1)
            lng += deltaLng

            points.add(Pair(lat / 1e5, lng / 1e5))
        }
        return points
    }
}
