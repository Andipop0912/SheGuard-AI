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
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.maps.model.LatLng
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.CircularBounds
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.net.PlacesClient
import com.google.android.libraries.places.api.net.SearchByTextRequest
import com.google.android.libraries.places.api.net.SearchNearbyRequest
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
 *
 * IMPORTANT (confirmed against Google's own documentation — see docs for
 * api-security-best-practices and the Places API (New) web-service FAQ): an Android-restricted
 * key is only supported for Google's client SDKs (Maps SDK for Android, Places SDK for Android,
 * Navigation SDK for Android) — NOT for direct REST calls to places.googleapis.com /
 * routes.googleapis.com, which is why the raw HTTP approach below produced
 * `API_KEY_ANDROID_APP_BLOCKED`. Places lookups therefore go through the official Places SDK for
 * Android (New) (`placesClient()` below), which IS Android-restriction-compatible. Routes
 * computation has no equivalent Android-restriction-compatible client SDK for arbitrary two-point
 * route geometry (Navigation SDK is a full turn-by-turn product, not a drop-in polyline
 * provider), so `computeRoute` below still makes the same direct REST call and will continue to
 * fail under an Android-restricted key — this is a known, reported limitation, not silently
 * worked around with fake data.
 */
class RouteSafetyGoogleModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardRouteSafety"
        private const val ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
        private const val MAX_PLACES = 20

        @Volatile
        private var cachedPlacesClient: PlacesClient? = null
        @Volatile
        private var placesInitialized = false
    }

    private val executor = Executors.newCachedThreadPool()

    override fun getName(): String = "SheGuardRouteSafetyModule"

    /** Lazily initializes the Places SDK (idempotent) and returns a client, or null if no key is configured. */
    private fun placesClient(): PlacesClient? {
        if (BuildConfig.GOOGLE_MAPS_API_KEY.isEmpty()) return null
        cachedPlacesClient?.let { return it }
        synchronized(this) {
            cachedPlacesClient?.let { return it }
            return try {
                val appContext = reactApplicationContext.applicationContext
                if (!placesInitialized) {
                    Places.initializeWithNewPlacesApiEnabled(appContext, BuildConfig.GOOGLE_MAPS_API_KEY)
                    placesInitialized = true
                }
                Places.createClient(appContext).also { cachedPlacesClient = it }
            } catch (e: Exception) {
                Log.e(TAG, "Could not initialize Places SDK", e)
                null
            }
        }
    }

    /** Classifies a Places SDK failure the same way httpStatusToErrorCode classifies a REST failure. */
    private fun placesExceptionToErrorCode(exception: Exception): String {
        val statusCode = (exception as? ApiException)?.statusCode
        Log.w(TAG, "Places SDK call failed: ${exception.javaClass.simpleName}" + (statusCode?.let { " (status $it)" } ?: ""))
        return when (statusCode) {
            7 -> "NETWORK" // com.google.android.gms.common.api.CommonStatusCodes.NETWORK_ERROR
            8 -> "SERVER_ERROR" // CommonStatusCodes.INTERNAL_ERROR
            else -> "PLACES_SEARCH_FAILED"
        }
    }

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

    /** Thrown with a stable `code` the JS layer can branch on, instead of a raw HTTP number. */
    class GoogleApiException(val code: String, message: String) : Exception(message)

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
                // Never log the API key itself — only the response body, which Google does not echo it into.
                Log.w(TAG, "Google API call to $urlString failed with HTTP $code: $text")
                throw GoogleApiException(httpStatusToErrorCode(code), "Google API error (HTTP $code)")
            }
            return JSONObject(text)
        } catch (e: java.net.SocketTimeoutException) {
            throw GoogleApiException("TIMEOUT", "Google API request timed out")
        } catch (e: java.io.IOException) {
            throw GoogleApiException("NETWORK", e.message ?: "Network error reaching Google API")
        } finally {
            connection.disconnect()
        }
    }

    /** Maps an HTTP status to a stable category the JS layer can show a truthful, distinct message for. */
    private fun httpStatusToErrorCode(httpStatus: Int): String = when (httpStatus) {
        401, 403 -> "AUTH_ERROR"
        429 -> "RATE_LIMITED"
        in 400..499 -> "CLIENT_ERROR"
        in 500..599 -> "SERVER_ERROR"
        else -> "UNKNOWN_ERROR"
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
                promise.reject((e as? GoogleApiException)?.code ?: "ROUTE_COMPUTE_FAILED", e.message, e)
            }
        }
    }

    /**
     * Resolves free-text (an address or a place name) to coordinates, biased near the device's
     * current location, using the Places SDK for Android (New) Text Search — not a direct REST
     * call, because Google does not support Android-app-restricted keys for the raw
     * places.googleapis.com web service (confirmed against Google's own documentation; see the
     * class-level comment). Never fabricates a destination: no match rejects the promise.
     */
    @ReactMethod
    fun geocodeText(query: String, biasLat: Double, biasLng: Double, promise: Promise) {
        val client = placesClient()
        if (client == null) {
            promise.reject("NOT_CONFIGURED", "Google Maps API key is not configured in this build")
            return
        }
        val placeFields = listOf(Place.Field.DISPLAY_NAME, Place.Field.FORMATTED_ADDRESS, Place.Field.LOCATION)
        val bias = CircularBounds.newInstance(LatLng(biasLat, biasLng), 50_000.0)
        val request = SearchByTextRequest.builder(query, placeFields)
            .setLocationBias(bias)
            .setMaxResultCount(1)
            .build()

        client.searchByText(request)
            .addOnSuccessListener { response ->
                val place = response.places.firstOrNull()
                val location = place?.location
                if (place == null || location == null) {
                    promise.reject("NOT_FOUND", "No place matched '$query'")
                    return@addOnSuccessListener
                }
                val result: WritableMap = Arguments.createMap()
                result.putDouble("latitude", location.latitude)
                result.putDouble("longitude", location.longitude)
                result.putString("formattedAddress", place.formattedAddress ?: query)
                promise.resolve(result)
            }
            .addOnFailureListener { exception ->
                promise.reject(placesExceptionToErrorCode(exception), exception.message, exception)
            }
    }

    /**
     * `placeType` is a Google Places (New) type, e.g. "hospital", "police", "fire_station".
     * Uses the Places SDK for Android (New) Nearby Search — see geocodeText's doc comment for why
     * this is not a direct REST call.
     */
    @ReactMethod
    fun searchNearbyPlaces(latitude: Double, longitude: Double, radiusMeters: Double, placeType: String, promise: Promise) {
        val client = placesClient()
        if (client == null) {
            promise.reject("NOT_CONFIGURED", "Google Maps API key is not configured in this build")
            return
        }
        val placeFields = listOf(Place.Field.ID, Place.Field.DISPLAY_NAME, Place.Field.FORMATTED_ADDRESS, Place.Field.LOCATION)
        // Nearby Search (New) requires a radius in (0, 50000] metres.
        val circle = CircularBounds.newInstance(LatLng(latitude, longitude), radiusMeters.coerceIn(1.0, 50_000.0))
        val request = SearchNearbyRequest.builder(circle, placeFields)
            .setIncludedTypes(listOf(placeType))
            .setMaxResultCount(MAX_PLACES)
            .build()

        client.searchNearby(request)
            .addOnSuccessListener { response ->
                val result: WritableArray = Arguments.createArray()
                response.places.forEach { place ->
                    val location = place.location
                    val item: WritableMap = Arguments.createMap()
                    item.putString("placeId", place.id ?: "")
                    item.putString("name", place.displayName ?: "")
                    item.putString("address", place.formattedAddress ?: "")
                    item.putDouble("latitude", location?.latitude ?: 0.0)
                    item.putDouble("longitude", location?.longitude ?: 0.0)
                    result.pushMap(item)
                }
                promise.resolve(result)
            }
            .addOnFailureListener { exception ->
                promise.reject(placesExceptionToErrorCode(exception), exception.message, exception)
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
