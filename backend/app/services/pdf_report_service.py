import io
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors

from app.db.models.communication_log import EmergencyCommunicationLog
from app.db.models.emergency_event import EmergencyEvent
from app.db.models.emergency_location import EmergencyLocation
from app.db.models.evidence import EvidenceItem

IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def _fmt(dt) -> str:
    if dt is None:
        return "Unknown"
    return dt.astimezone(IST).strftime("%d %b %Y, %H:%M IST")


def build_incident_report_pdf(
    event: EmergencyEvent,
    locations: List[EmergencyLocation],
    communication_logs: List[EmergencyCommunicationLog],
    evidence_items: List[EvidenceItem],
    route_safety_summary: Optional[str] = None,
) -> bytes:
    """
    Builds a PDF strictly from the real stored rows passed in — no field here is invented. A
    missing value is shown as "Unknown" / "Not available", never fabricated.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("SheGuardTitle", parent=styles["Title"], textColor=colors.HexColor("#0f172a"))
    heading_style = ParagraphStyle("SheGuardHeading", parent=styles["Heading2"], textColor=colors.HexColor("#0284c7"), spaceBefore=14)
    body = styles["BodyText"]

    story = [
        Paragraph("SheGuard Incident Report", title_style),
        Spacer(1, 4 * mm),
        Paragraph(f"Incident ID: {event.event_id}", body),
        Paragraph(f"Generated: {_fmt(datetime.now(timezone.utc))}", body),
        Spacer(1, 6 * mm),
    ]

    story.append(Paragraph("Incident Summary", heading_style))
    summary_rows = [
        ["Trigger source", event.trigger_source.value],
        ["Status", event.state.value],
        ["Device", event.device_id],
        ["Server received", _fmt(event.server_received_at)],
    ]
    story.append(_table(summary_rows))

    story.append(Paragraph("Location", heading_style))
    if locations:
        latest = max(locations, key=lambda p: p.captured_at)
        loc_rows = [
            ["Latest fix", f"{latest.latitude:.5f}, {latest.longitude:.5f}"],
            ["Accuracy", f"{latest.accuracy_m:.0f} m" if latest.accuracy_m is not None else "Unknown"],
            ["Points recorded", str(len(locations))],
        ]
        story.append(_table(loc_rows))
    else:
        story.append(Paragraph("No location was recorded for this incident.", body))

    if route_safety_summary:
        story.append(Paragraph("Route Safety", heading_style))
        story.append(Paragraph(route_safety_summary, body))

    story.append(Paragraph("Trusted Contact Communication", heading_style))
    if communication_logs:
        comm_rows = [["Channel", "Status", "Provider"]]
        for log in communication_logs:
            comm_rows.append([
                log.channel.value,
                log.status.value,
                "Simulated" if log.is_simulated else "Real",
            ])
        story.append(_table(comm_rows, header=True))
    else:
        story.append(Paragraph("No trusted-contact communication records exist for this incident.", body))

    story.append(Paragraph("Evidence", heading_style))
    if evidence_items:
        ev_rows = [["Type", "Duration", "Recorded at", "Status"]]
        for item in evidence_items:
            duration = f"{(item.duration_ms or 0) // 1000}s" if item.duration_ms else "Unknown"
            ev_rows.append([item.type, duration, _fmt(item.created_at), item.upload_status.value])
        story.append(_table(ev_rows, header=True))
    else:
        story.append(Paragraph("No evidence was recorded for this incident.", body))

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "This report was generated automatically from data recorded by the SheGuard AI app. "
        "It contains only facts captured by the app's sensors, user actions and server records; "
        "it does not include any AI-inferred conclusions about what occurred.",
        styles["Italic"],
    ))

    doc.build(story)
    return buffer.getvalue()


def _table(rows: List[List[str]], header: bool = False) -> Table:
    table = Table(rows, hAlign="LEFT", colWidths=None)
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")))
        style.append(("TEXTCOLOR", (0, 0), (-1, 0), colors.white))
        style.append(("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"))
    table.setStyle(TableStyle(style))
    return table
