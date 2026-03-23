#!/usr/bin/env python3

import argparse
import base64
import io
import json
import os
import sys
import tempfile
import time
import warnings
from typing import Any, Dict, List, Optional, Set, Tuple


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))


def parse_pages_spec(spec: Optional[str], total_pages: int) -> List[int]:
    if total_pages <= 0:
        raise ValueError("PDF has no pages")

    if spec is None or str(spec).strip() == "":
        return list(range(total_pages))

    selected: Set[int] = set()

    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue

        if "-" in token:
            start_str, end_str = token.split("-", 1)
            start = int(start_str)
            end = int(end_str)
            if start > end:
                raise ValueError(f"Invalid page range: {token}")
            pages = range(start, end + 1)
        else:
            pages = [int(token)]

        for page_num in pages:
            if page_num < 1 or page_num > total_pages:
                raise ValueError(f"Page out of bounds: {page_num}")
            selected.add(page_num - 1)

    if not selected:
        raise ValueError("No pages selected")

    return sorted(selected)


def parse_page_index(page_number: int, total_pages: int) -> int:
    if page_number < 1 or page_number > total_pages:
        raise ValueError(f"Page out of bounds: {page_number}")
    return page_number - 1


def ensure_output_dir(output_path: str) -> None:
    directory = os.path.dirname(output_path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def parse_hex_color(value: str, fallback: Tuple[float, float, float]) -> Tuple[float, float, float]:
    text = (value or "").strip()
    if not text:
        return fallback

    if text.startswith("#"):
        text = text[1:]

    if len(text) == 3:
        text = "".join([ch * 2 for ch in text])

    if len(text) != 6:
        return fallback

    try:
        r = int(text[0:2], 16) / 255.0
        g = int(text[2:4], 16) / 255.0
        b = int(text[4:6], 16) / 255.0
        return (r, g, b)
    except ValueError:
        return fallback


def normalize_hex_color(value: str, fallback: str) -> str:
    text = (value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join([ch * 2 for ch in text])
    if len(text) != 6:
        return fallback
    try:
        int(text, 16)
        return text.lower()
    except ValueError:
        return fallback


def resolve_font_name(font_family: str) -> str:
    family = (font_family or "helvetica").strip().lower()
    families = {
        "helvetica": "Helvetica",
        "times": "Times-Roman",
        "courier": "Courier",
    }
    return families.get(family, "Helvetica")


def annotation_rect(x: float, y: float, width: float, height: float) -> Tuple[float, float, float, float]:
    left = float(x)
    bottom = float(y)
    right = left + float(width)
    top = bottom + float(height)
    return (left, bottom, right, top)


def collect_signature_summaries(input_path: str, PdfFileReader) -> List[dict]:
    signatures: List[dict] = []
    if PdfFileReader is None:
        return signatures

    try:
        with open(input_path, "rb") as sig_input:
            reader = PdfFileReader(sig_input)
            for embedded_sig in reader.embedded_signatures:
                signer_name = None
                signer_subject = None
                signer_cert = embedded_sig.signer_cert
                if signer_cert is not None:
                    signer_subject = getattr(signer_cert.subject, "human_friendly", None)
                    native = getattr(signer_cert.subject, "native", {}) or {}
                    signer_name = native.get("common_name") or signer_subject

                try:
                    embedded_sig.compute_integrity_info()
                    integrity_info = embedded_sig.summarise_integrity_info()
                    coverage = getattr(integrity_info.get("coverage"), "name", None)
                    diff_result = integrity_info.get("diff_result")
                    modification_level = getattr(getattr(diff_result, "modification_level", None), "name", None)
                    changed_form_fields = sorted(getattr(diff_result, "changed_form_fields", set()) or [])
                    integrity = {
                        "coverage": coverage,
                        "docMdpOk": bool(integrity_info.get("docmdp_ok", True)),
                        "modificationLevel": modification_level,
                        "changedFormFields": changed_form_fields,
                    }
                except Exception as exc:  # noqa: BLE001
                    integrity = {"error": str(exc)}

                timestamp = embedded_sig.self_reported_timestamp
                signatures.append(
                    {
                        "fieldName": embedded_sig.field_name,
                        "signerName": signer_name,
                        "signerSubject": signer_subject,
                        "signedAt": timestamp.isoformat() if timestamp else None,
                        "docMdpLevel": getattr(embedded_sig.docmdp_level, "name", None),
                        "integrity": integrity,
                    }
                )
    except Exception:
        return signatures

    return signatures


FORM_FLAG_READ_ONLY = 1 << 0
FORM_FLAG_REQUIRED = 1 << 1
TEXT_FLAG_MULTILINE = 1 << 12
BUTTON_FLAG_RADIO = 1 << 15
BUTTON_FLAG_PUSHBUTTON = 1 << 16
CHOICE_FLAG_COMBO = 1 << 17
CHOICE_FLAG_MULTISELECT = 1 << 21


def decode_pdf_name(value: Any) -> Optional[str]:
    if value is None:
        return None

    text = str(value)
    if text.startswith("/"):
        return text[1:]
    return text


def json_safe_pdf_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (list, tuple)):
        return [json_safe_pdf_value(item) for item in value]
    return decode_pdf_name(value)


def normalize_form_option(raw_option: Any) -> Dict[str, str]:
    if isinstance(raw_option, (list, tuple)) and len(raw_option) >= 2:
        value = json_safe_pdf_value(raw_option[0])
        label = json_safe_pdf_value(raw_option[1])
        return {
            "value": str(value or ""),
            "label": str(label or value or ""),
        }

    value = json_safe_pdf_value(raw_option)
    return {
        "value": str(value or ""),
        "label": str(value or ""),
    }


def build_page_ref_lookup(reader) -> Dict[Tuple[int, int], int]:
    lookup: Dict[Tuple[int, int], int] = {}
    for index, page in enumerate(reader.pages):
        ref = getattr(page, "indirect_reference", None) or getattr(page, "indirect_ref", None)
        if ref is not None:
            lookup[(int(ref.idnum), int(ref.generation))] = index + 1
    return lookup


def resolve_page_number(page_ref, lookup: Dict[Tuple[int, int], int]) -> Optional[int]:
    if page_ref is None:
        return None

    idnum = getattr(page_ref, "idnum", None)
    generation = getattr(page_ref, "generation", None)
    if idnum is None or generation is None:
        return None
    return lookup.get((int(idnum), int(generation)))


def button_export_values(field_obj, child_widgets: List[Any]) -> List[str]:
    values: List[str] = []

    def read_from_ap(target_obj) -> None:
        ap = target_obj.get("/AP")
        if not ap:
            return
        normal = ap.get("/N")
        if not normal:
            return
        keys = list(getattr(normal, "keys", lambda: [])())
        for key in keys:
            value = decode_pdf_name(key)
            if value and value not in {"Off"} and value not in values:
                values.append(value)

    read_from_ap(field_obj)
    for child in child_widgets:
        read_from_ap(child)

    return values


def first_widget_page_number(field_obj, child_widgets: List[Any], page_lookup: Dict[Tuple[int, int], int], inherited_page_number: Optional[int]) -> Optional[int]:
    direct_page = resolve_page_number(field_obj.get("/P"), page_lookup)
    if direct_page is not None:
        return direct_page

    for child in child_widgets:
        child_page = resolve_page_number(child.get("/P"), page_lookup)
        if child_page is not None:
            return child_page

    return inherited_page_number


def flatten_terminal_form_fields(reader) -> List[Tuple[Any, str, Optional[int], List[Any]]]:
    root = reader.trailer.get("/Root")
    if not root:
        return []

    acro_form = root.get("/AcroForm")
    if not acro_form:
        return []

    field_refs = acro_form.get_object().get("/Fields") or []
    page_lookup = build_page_ref_lookup(reader)
    flattened: List[Tuple[Any, str, Optional[int], List[Any]]] = []
    seen: Set[Tuple[int, int]] = set()

    def visit(field_obj, parent_name: Optional[str], inherited_page_number: Optional[int]) -> None:
        ref = getattr(field_obj, "indirect_reference", None)
        if ref is not None:
            ref_key = (int(ref.idnum), int(ref.generation))
            if ref_key in seen:
                return
            seen.add(ref_key)

        raw_name = str(field_obj.get("/T") or "").strip()
        qualified_name = ".".join(part for part in [parent_name, raw_name] if part)
        field_type = decode_pdf_name(field_obj.get("/FT"))
        flags = int(field_obj.get("/Ff", 0) or 0)
        child_widgets = [kid.get_object() for kid in field_obj.get("/Kids", []) or []]
        page_number = first_widget_page_number(field_obj, child_widgets, page_lookup, inherited_page_number)

        has_child_fields = any(
            child.get("/T") is not None or (child.get("/FT") is not None and child.get("/Subtype") != "/Widget")
            for child in child_widgets
        )

        is_pushbutton = field_type == "Btn" and bool(flags & BUTTON_FLAG_PUSHBUTTON)
        is_signature = field_type == "Sig"

        if field_type and not has_child_fields and not is_pushbutton and not is_signature:
            flattened.append((field_obj, qualified_name or raw_name, page_number, child_widgets))
            return

        for child in child_widgets:
            visit(child, qualified_name or parent_name, page_number)

    for field_ref in field_refs:
        visit(field_ref.get_object(), None, None)

    return flattened


def serialize_form_field(field_obj, qualified_name: str, page_number: Optional[int], child_widgets: List[Any]) -> Optional[dict]:
    field_type = decode_pdf_name(field_obj.get("/FT"))
    if not field_type:
        return None

    flags = int(field_obj.get("/Ff", 0) or 0)
    short_name = str(field_obj.get("/T") or qualified_name or "").strip()
    label = str(field_obj.get("/TU") or short_name or qualified_name or "Unnamed field")
    base = {
        "id": qualified_name or short_name,
        "name": qualified_name or short_name,
        "shortName": short_name or qualified_name,
        "label": label,
        "page": page_number,
        "readOnly": bool(flags & FORM_FLAG_READ_ONLY),
        "required": bool(flags & FORM_FLAG_REQUIRED),
        "rawType": field_type,
    }

    if field_type == "Tx":
        multiline = bool(flags & TEXT_FLAG_MULTILINE)
        base.update(
            {
                "type": "textarea" if multiline else "text",
                "value": str(field_obj.get("/V") or field_obj.get("/DV") or ""),
                "options": [],
                "multiline": multiline,
            }
        )
        return base

    if field_type == "Btn":
        export_values = button_export_values(field_obj, child_widgets)
        current_value = decode_pdf_name(field_obj.get("/V")) or decode_pdf_name(field_obj.get("/AS"))

        if flags & BUTTON_FLAG_RADIO:
            base.update(
                {
                    "type": "radio",
                    "value": current_value or "",
                    "options": [{"value": value, "label": value} for value in export_values],
                    "multiline": False,
                }
            )
            return base

        export_value = export_values[0] if export_values else "Yes"
        base.update(
            {
                "type": "checkbox",
                "value": bool(current_value and current_value != "Off"),
                "options": [],
                "exportValue": export_value,
                "multiline": False,
            }
        )
        return base

    if field_type == "Ch":
        options = [normalize_form_option(option) for option in field_obj.get("/Opt", []) or []]
        is_multiselect = bool(flags & CHOICE_FLAG_MULTISELECT)
        current_value = field_obj.get("/V")
        normalized_value = json_safe_pdf_value(current_value)
        if is_multiselect and not isinstance(normalized_value, list):
            normalized_value = [] if normalized_value in {None, ""} else [normalized_value]
        if not is_multiselect and normalized_value is None:
            normalized_value = ""

        base.update(
            {
                "type": "multiselect" if is_multiselect else "select",
                "value": normalized_value,
                "options": options,
                "multiline": False,
                "combo": bool(flags & CHOICE_FLAG_COMBO),
            }
        )
        return base

    return None


def collect_form_fields(reader) -> List[dict]:
    fields: List[dict] = []
    for field_obj, qualified_name, page_number, child_widgets in flatten_terminal_form_fields(reader):
        serialized = serialize_form_field(field_obj, qualified_name, page_number, child_widgets)
        if serialized is not None:
            fields.append(serialized)

    fields.sort(key=lambda item: ((item.get("page") or 0), str(item.get("label") or item.get("name") or "")))
    return fields


def checkbox_update_value(field: dict, incoming: Any) -> str:
    if isinstance(incoming, bool):
        truthy = incoming
    else:
        normalized = str(incoming or "").strip().lower()
        truthy = normalized in {"1", "true", "yes", "on", "checked"}
    return f"/{field.get('exportValue') or 'Yes'}" if truthy else "/Off"


def radio_update_value(incoming: Any) -> str:
    text = str(incoming or "").strip()
    if not text:
        return "/Off"
    return text if text.startswith("/") else f"/{text}"


SIGNATURE_SCRIPT_FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Brush Script.ttf",
    "/System/Library/Fonts/Supplemental/Apple Chancery.ttf",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Supplemental/Zapfino.ttf",
]


def decode_image_payload(image_payload: str) -> bytes:
    payload = (image_payload or "").strip()
    if payload.startswith("data:"):
        parts = payload.split(",", 1)
        payload = parts[1] if len(parts) == 2 else ""

    if not payload:
        raise ValueError("Signature image payload is empty")

    return base64.b64decode(payload)


def clamp_stamp_line(value: str, width: float, font_size: float) -> str:
    text = (value or "").strip()
    if not text:
        return ""

    max_chars = max(18, int(width / max(font_size * 0.5, 1.0)))
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3].rstrip()}..."


def choose_signature_font_path() -> Optional[str]:
    for candidate in SIGNATURE_SCRIPT_FONT_PATHS:
        if os.path.exists(candidate):
            return candidate
    return None


def render_typed_signature_image(text: str, width: float, height: float, Image, ImageDraw, ImageFont):
    if not (text or "").strip():
        raise ValueError("Type a visible signature name before signing")

    scale = 4
    image = Image.new(
        "RGBA",
        (max(int(round(width * scale)), 8), max(int(round(height * scale)), 8)),
        (255, 255, 255, 0),
    )
    draw = ImageDraw.Draw(image)
    font_path = choose_signature_font_path()
    fallback_font = ImageFont.load_default()

    def load_font(font_size: int):
        if font_path:
            try:
                return ImageFont.truetype(font_path, font_size)
            except Exception:  # noqa: BLE001
                return fallback_font
        return fallback_font

    best_font = fallback_font
    best_box = draw.textbbox((0, 0), text, font=best_font)
    max_font = max(32, int(image.height * 0.72))
    min_font = 18
    for font_size in range(max_font, min_font - 1, -4):
        trial_font = load_font(font_size)
        trial_box = draw.textbbox((0, 0), text, font=trial_font)
        trial_width = trial_box[2] - trial_box[0]
        trial_height = trial_box[3] - trial_box[1]
        if trial_width <= image.width * 0.92 and trial_height <= image.height * 0.82:
            best_font = trial_font
            best_box = trial_box
            break

    text_width = best_box[2] - best_box[0]
    text_height = best_box[3] - best_box[1]
    x = (image.width - text_width) / 2 - best_box[0]
    y = (image.height - text_height) / 2 - best_box[1]
    draw.text((x, y), text, font=best_font, fill=(23, 34, 41, 255))
    return image


def render_drawn_signature_image(image_payload: str, Image):
    image = Image.open(io.BytesIO(decode_image_payload(image_payload))).convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("Draw the visible signature before signing")
    return image.crop(bbox)


def create_signature_appearance_pdf(
    output_path: str,
    mode: str,
    width: float,
    height: float,
    appearance_text: Optional[str],
    appearance_image_base64: Optional[str],
    signer_name: Optional[str],
    reason: Optional[str],
    location: Optional[str],
    canvas,
    ImageReader,
    Image,
    ImageDraw,
    ImageFont,
) -> None:
    ensure_output_dir(output_path)
    signer_label = (signer_name or appearance_text or "Digital signature").strip()
    margin = max(8.0, min(width, height) * 0.08)
    footer_font = max(6.5, min(9.5, height * 0.12))
    footer_area = max(20.0, min(height * 0.34, 34.0))
    draw_left = margin
    draw_bottom = margin + footer_area
    draw_width = max(width - margin * 2, 24.0)
    draw_height = max(height - draw_bottom - margin, 18.0)
    line_y = draw_bottom - 7

    pdf = canvas.Canvas(output_path, pagesize=(width, height))
    pdf.setLineWidth(0.75)
    pdf.setStrokeColorRGB(0.49, 0.82, 0.79)
    pdf.line(margin, line_y, width - margin, line_y)

    if mode == "draw":
        image = render_drawn_signature_image(appearance_image_base64 or "", Image)
        pdf.drawImage(
            ImageReader(image),
            draw_left,
            draw_bottom,
            width=draw_width,
            height=draw_height,
            preserveAspectRatio=True,
            anchor="c",
            mask="auto",
        )
    elif mode == "type":
        image = render_typed_signature_image(appearance_text or signer_label, draw_width, draw_height, Image, ImageDraw, ImageFont)
        pdf.drawImage(
            ImageReader(image),
            draw_left,
            draw_bottom,
            width=draw_width,
            height=draw_height,
            preserveAspectRatio=True,
            anchor="c",
            mask="auto",
        )
    else:
        pdf.setFillColorRGB(0.09, 0.13, 0.16)
        pdf.setFont("Helvetica-Bold", max(10.0, min(height * 0.2, 15.0)))
        pdf.drawString(margin, draw_bottom + max(draw_height * 0.3, 6.0), clamp_stamp_line(signer_label, draw_width, 12.0))

    footer_lines = [f"Digitally signed by {signer_label}"]
    if reason:
        footer_lines.append(f"Reason: {reason}")
    elif location:
        footer_lines.append(f"Location: {location}")

    pdf.setFillColorRGB(0.23, 0.28, 0.33)
    pdf.setFont("Helvetica", footer_font)
    text_y = margin + footer_font + 2
    for line in reversed(footer_lines[:2]):
        pdf.drawString(margin, text_y, clamp_stamp_line(line, width - margin * 2, footer_font))
        text_y += footer_font + 2

    pdf.showPage()
    pdf.save()


def overlay_page(reader, page_index: int, draw_fn, PdfReader, PdfWriter, canvas) -> "PdfWriter":
    page = reader.pages[page_index]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)

    overlay_bytes = io.BytesIO()
    overlay_canvas = canvas.Canvas(overlay_bytes, pagesize=(width, height))
    draw_fn(overlay_canvas)
    overlay_canvas.save()
    overlay_bytes.seek(0)

    overlay = PdfReader(overlay_bytes).pages[0]

    writer = PdfWriter()
    for idx, existing_page in enumerate(reader.pages):
        if idx == page_index:
            existing_page.merge_page(overlay)
        writer.add_page(existing_page)

    return writer


def main() -> int:
    warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

    try:
        import pdfplumber
        from PIL import Image, ImageDraw, ImageFont
        from pypdf import PdfReader, PdfWriter
        from pypdf.annotations import FreeText, Highlight
        from pypdf.generic import ArrayObject, FloatObject, NameObject
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas
    except Exception as exc:  # noqa: BLE001
        emit(
            {
                "ok": False,
                "error": "Missing dependency. Install with: python3 -m pip install pypdf pdfplumber reportlab Pillow pyHanko",
                "details": str(exc),
            }
        )
        return 0

    try:
        from pyhanko.sign import fields, signers, timestamps
        from pyhanko.sign.fields import MDPPerm, SigSeedSubFilter
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.stamp import StaticStampStyle, TextStampStyle
    except Exception:  # noqa: BLE001
        fields = None
        signers = None
        timestamps = None
        MDPPerm = None
        SigSeedSubFilter = None
        IncrementalPdfFileWriter = None
        PdfFileReader = None
        StaticStampStyle = None
        TextStampStyle = None

    parser = argparse.ArgumentParser(description="Local PDF operations helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", required=True)

    extract_parser = subparsers.add_parser("extract-text")
    extract_parser.add_argument("--input", required=True)
    extract_parser.add_argument("--pages", required=False)

    rotate_parser = subparsers.add_parser("rotate")
    rotate_parser.add_argument("--input", required=True)
    rotate_parser.add_argument("--output", required=True)
    rotate_parser.add_argument("--pages", required=True)
    rotate_parser.add_argument("--degrees", required=True, type=int)

    delete_parser = subparsers.add_parser("delete-pages")
    delete_parser.add_argument("--input", required=True)
    delete_parser.add_argument("--output", required=True)
    delete_parser.add_argument("--pages", required=True)

    extract_pages_parser = subparsers.add_parser("extract-pages")
    extract_pages_parser.add_argument("--input", required=True)
    extract_pages_parser.add_argument("--output", required=True)
    extract_pages_parser.add_argument("--pages", required=True)

    merge_parser = subparsers.add_parser("merge")
    merge_parser.add_argument("--output", required=True)
    merge_parser.add_argument("--inputs", nargs="+", required=True)

    add_text_parser = subparsers.add_parser("add-text")
    add_text_parser.add_argument("--input", required=True)
    add_text_parser.add_argument("--output", required=True)
    add_text_parser.add_argument("--page", required=True, type=int)
    add_text_parser.add_argument("--x", required=True, type=float)
    add_text_parser.add_argument("--y", required=True, type=float)
    add_text_parser.add_argument("--text", required=True)
    add_text_parser.add_argument("--font-size", required=True, type=float)
    add_text_parser.add_argument("--font-family", required=False, default="helvetica")
    add_text_parser.add_argument("--bold", action="store_true")
    add_text_parser.add_argument("--italic", action="store_true")
    add_text_parser.add_argument("--underline", action="store_true")
    add_text_parser.add_argument("--color", required=False, default="#111111")

    highlight_parser = subparsers.add_parser("highlight")
    highlight_parser.add_argument("--input", required=True)
    highlight_parser.add_argument("--output", required=True)
    highlight_parser.add_argument("--page", required=True, type=int)
    highlight_parser.add_argument("--x", required=True, type=float)
    highlight_parser.add_argument("--y", required=True, type=float)
    highlight_parser.add_argument("--width", required=True, type=float)
    highlight_parser.add_argument("--height", required=True, type=float)
    highlight_parser.add_argument("--color", required=False, default="#ffe16b")
    highlight_parser.add_argument("--opacity", required=False, type=float, default=0.35)

    signature_parser = subparsers.add_parser("add-signature")
    signature_parser.add_argument("--input", required=True)
    signature_parser.add_argument("--output", required=True)
    signature_parser.add_argument("--page", required=True, type=int)
    signature_parser.add_argument("--x", required=True, type=float)
    signature_parser.add_argument("--y", required=True, type=float)
    signature_parser.add_argument("--width", required=True, type=float)
    signature_parser.add_argument("--height", required=True, type=float)
    signature_parser.add_argument("--image-base64", required=True)

    fill_form_parser = subparsers.add_parser("fill-form-fields")
    fill_form_parser.add_argument("--input", required=True)
    fill_form_parser.add_argument("--output", required=True)
    fill_form_parser.add_argument("--values-json", required=True)

    sign_pkcs12_parser = subparsers.add_parser("sign-pkcs12")
    sign_pkcs12_parser.add_argument("--input", required=True)
    sign_pkcs12_parser.add_argument("--output", required=True)
    sign_pkcs12_parser.add_argument("--pfx", required=True)
    sign_pkcs12_parser.add_argument("--password", required=False, default="")
    sign_pkcs12_parser.add_argument("--page", required=True, type=int)
    sign_pkcs12_parser.add_argument("--x", required=True, type=float)
    sign_pkcs12_parser.add_argument("--y", required=True, type=float)
    sign_pkcs12_parser.add_argument("--width", required=True, type=float)
    sign_pkcs12_parser.add_argument("--height", required=True, type=float)
    sign_pkcs12_parser.add_argument("--field-name", required=False)
    sign_pkcs12_parser.add_argument("--name", required=False)
    sign_pkcs12_parser.add_argument("--reason", required=False)
    sign_pkcs12_parser.add_argument("--location", required=False)
    sign_pkcs12_parser.add_argument("--contact-info", required=False)
    sign_pkcs12_parser.add_argument("--timestamp-url", required=False)
    sign_pkcs12_parser.add_argument("--certify", action="store_true")
    sign_pkcs12_parser.add_argument(
        "--doc-mdp-permissions",
        required=False,
        choices=["no_changes", "fill_forms", "annotate"],
        default="fill_forms",
    )
    sign_pkcs12_parser.add_argument(
        "--appearance-mode",
        required=False,
        choices=["type", "draw", "standard"],
        default="type",
    )
    sign_pkcs12_parser.add_argument("--appearance-text", required=False)
    sign_pkcs12_parser.add_argument("--appearance-image-base64", required=False)

    args = parser.parse_args()

    try:
        if args.command == "inspect":
            reader = PdfReader(args.input)
            page_sizes = []
            for page in reader.pages:
                page_sizes.append({"width": float(page.mediabox.width), "height": float(page.mediabox.height)})
            emit(
                {
                    "ok": True,
                    "pageCount": len(reader.pages),
                    "pageSizes": page_sizes,
                    "forms": collect_form_fields(reader),
                    "signatures": collect_signature_summaries(args.input, PdfFileReader),
                }
            )
            return 0

        if args.command == "extract-text":
            with pdfplumber.open(args.input) as pdf:
                selected_pages = parse_pages_spec(args.pages, len(pdf.pages))
                chunks: List[str] = []
                for idx in selected_pages:
                    page_text = pdf.pages[idx].extract_text() or ""
                    chunks.append(f"--- Page {idx + 1} ---\n{page_text}")

            text = "\n\n".join(chunks).strip()
            emit(
                {
                    "ok": True,
                    "text": text,
                    "charCount": len(text),
                    "pageCount": len(selected_pages),
                }
            )
            return 0

        if args.command == "rotate":
            reader = PdfReader(args.input)
            selected_pages = set(parse_pages_spec(args.pages, len(reader.pages)))

            normalized_degrees = args.degrees % 360
            if normalized_degrees not in {0, 90, 180, 270}:
                raise ValueError("Rotation must be a multiple of 90")

            writer = PdfWriter()
            for idx, page in enumerate(reader.pages):
                if idx in selected_pages and normalized_degrees:
                    page.rotate(normalized_degrees)
                writer.add_page(page)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "delete-pages":
            reader = PdfReader(args.input)
            remove_pages = set(parse_pages_spec(args.pages, len(reader.pages)))

            if len(remove_pages) >= len(reader.pages):
                raise ValueError("Cannot delete every page")

            writer = PdfWriter()
            for idx, page in enumerate(reader.pages):
                if idx not in remove_pages:
                    writer.add_page(page)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "extract-pages":
            reader = PdfReader(args.input)
            keep_pages = parse_pages_spec(args.pages, len(reader.pages))

            writer = PdfWriter()
            for idx in keep_pages:
                writer.add_page(reader.pages[idx])

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "merge":
            if len(args.inputs) < 2:
                raise ValueError("Provide at least two input PDF files")

            writer = PdfWriter()
            for input_path in args.inputs:
                reader = PdfReader(input_path)
                for page in reader.pages:
                    writer.add_page(page)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "add-text":
            reader = PdfReader(args.input)
            page_index = parse_page_index(args.page, len(reader.pages))
            color = normalize_hex_color(args.color, "111111")
            writer = PdfWriter(args.input, incremental=True)
            lines = args.text.splitlines() if args.text else [args.text]
            line_count = max(1, len(lines))
            box_height = max(float(args.font_size) * 1.35 * line_count, 18.0)
            box_width = max(120.0, max((len(line) for line in lines), default=1) * float(args.font_size) * 0.62)
            annotation = FreeText(
                text=args.text,
                rect=annotation_rect(args.x, args.y, box_width, box_height),
                font=resolve_font_name(args.font_family),
                bold=args.bold,
                italic=args.italic,
                font_size=f"{max(args.font_size, 6):.0f}pt",
                font_color=color,
                border_color=None,
                background_color=None,
            )
            writer.add_annotation(page_index, annotation)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "highlight":
            reader = PdfReader(args.input)
            page_index = parse_page_index(args.page, len(reader.pages))
            color = normalize_hex_color(args.color, "ffe16b")
            opacity = max(0.05, min(float(args.opacity), 1.0))
            left, bottom, right, top = annotation_rect(args.x, args.y, args.width, args.height)
            quad_points = ArrayObject(
                [
                    FloatObject(left),
                    FloatObject(top),
                    FloatObject(right),
                    FloatObject(top),
                    FloatObject(left),
                    FloatObject(bottom),
                    FloatObject(right),
                    FloatObject(bottom),
                ]
            )
            writer = PdfWriter(args.input, incremental=True)
            annotation = Highlight(
                rect=(left, bottom, right, top),
                quad_points=quad_points,
                highlight_color=color,
                printing=True,
            )
            annotation[NameObject("/CA")] = FloatObject(opacity)
            writer.add_annotation(page_index, annotation)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "add-signature":
            reader = PdfReader(args.input)
            page_index = parse_page_index(args.page, len(reader.pages))

            image_payload = args.image_base64
            if image_payload.startswith("data:"):
                parts = image_payload.split(",", 1)
                image_payload = parts[1] if len(parts) == 2 else ""

            if not image_payload:
                raise ValueError("Signature image payload is empty")

            image_bytes = base64.b64decode(image_payload)
            image_reader = ImageReader(io.BytesIO(image_bytes))

            def draw_signature(draw_canvas):
                draw_canvas.drawImage(
                    image_reader,
                    args.x,
                    args.y,
                    width=args.width,
                    height=args.height,
                    mask="auto",
                )

            writer = overlay_page(reader, page_index, draw_signature, PdfReader, PdfWriter, canvas)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True})
            return 0

        if args.command == "fill-form-fields":
            try:
                requested_values = json.loads(args.values_json)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid form field payload: {exc.msg}") from exc

            if not isinstance(requested_values, dict):
                raise ValueError("Form field payload must be a JSON object")

            reader = PdfReader(args.input)
            available_fields = collect_form_fields(reader)
            by_name = {field["name"]: field for field in available_fields if field.get("name")}
            by_short_name = {field["shortName"]: field for field in available_fields if field.get("shortName")}

            updates: Dict[str, Any] = {}
            for incoming_name, incoming_value in requested_values.items():
                field = by_name.get(str(incoming_name)) or by_short_name.get(str(incoming_name))
                if field is None or field.get("readOnly"):
                    continue

                field_name = field.get("name") or field.get("shortName")
                field_type = field.get("type")

                if field_type == "checkbox":
                    updates[str(field_name)] = checkbox_update_value(field, incoming_value)
                elif field_type == "radio":
                    updates[str(field_name)] = radio_update_value(incoming_value)
                elif field_type == "multiselect":
                    if isinstance(incoming_value, list):
                        updates[str(field_name)] = [str(value) for value in incoming_value]
                    elif incoming_value is None or incoming_value == "":
                        updates[str(field_name)] = []
                    else:
                        updates[str(field_name)] = [str(incoming_value)]
                elif field_type in {"select", "text", "textarea"}:
                    updates[str(field_name)] = "" if incoming_value is None else str(incoming_value)

            if not updates:
                raise ValueError("No matching editable form fields were supplied")

            writer = PdfWriter(args.input, incremental=True)
            writer.update_page_form_field_values(None, updates, auto_regenerate=False)

            if hasattr(writer, "set_need_appearances_writer"):
                writer.set_need_appearances_writer(True)

            ensure_output_dir(args.output)
            with open(args.output, "wb") as output_file:
                writer.write(output_file)

            emit({"ok": True, "updatedFields": sorted(updates.keys())})
            return 0

        if args.command == "sign-pkcs12":
            if signers is None or fields is None or IncrementalPdfFileWriter is None or TextStampStyle is None:
                raise ValueError("Digital signing support requires pyHanko to be installed")

            with open(args.input, "rb") as doc_check:
                reader = PdfReader(doc_check)
                page_index = parse_page_index(args.page, len(reader.pages))

            permission_map = {
                "no_changes": MDPPerm.NO_CHANGES,
                "fill_forms": MDPPerm.FILL_FORMS,
                "annotate": MDPPerm.ANNOTATE,
            }
            doc_mdp_permissions = permission_map[args.doc_mdp_permissions]

            signer = signers.SimpleSigner.load_pkcs12(
                args.pfx,
                passphrase=args.password.encode("utf8") if args.password else None,
            )
            certificate_signer_name = None
            signing_cert = getattr(signer, "signing_cert", None)
            if signing_cert is not None:
                native_subject = getattr(signing_cert.subject, "native", {}) or {}
                certificate_signer_name = native_subject.get("common_name") or getattr(signing_cert.subject, "human_friendly", None)

            with open(args.input, "rb") as count_input:
                sig_reader = PdfFileReader(count_input) if PdfFileReader is not None else None
                field_name = args.field_name or f"Signature{len(sig_reader.embedded_signatures) + 1 if sig_reader else int(time.time())}"

            box = (
                int(round(args.x)),
                int(round(args.y)),
                int(round(args.x + args.width)),
                int(round(args.y + args.height)),
            )

            appearance_mode = args.appearance_mode or "type"
            appearance_text = (args.appearance_text or "").strip() or (args.name or "").strip() or (certificate_signer_name or "").strip()
            appearance_text_params = None

            signature_meta = signers.PdfSignatureMetadata(
                field_name=field_name,
                name=args.name or certificate_signer_name or appearance_text or None,
                reason=args.reason or None,
                location=args.location or None,
                contact_info=args.contact_info or None,
                certify=args.certify,
                subfilter=SigSeedSubFilter.PADES,
                docmdp_permissions=doc_mdp_permissions,
            )

            timestamper = None
            if args.timestamp_url:
                timestamper = timestamps.HTTPTimeStamper(args.timestamp_url)

            appearance_pdf_path = None
            try:
                if appearance_mode == "standard":
                    stamp_lines = ["Digitally signed by %(signer)s", "Date: %(ts)s"]
                    appearance_text_params = {}
                    if args.reason:
                        stamp_lines.append("Reason: %(reason)s")
                        appearance_text_params["reason"] = args.reason
                    if args.location:
                        stamp_lines.append("Location: %(location)s")
                        appearance_text_params["location"] = args.location
                    if args.contact_info:
                        stamp_lines.append("Contact: %(contact_info)s")
                        appearance_text_params["contact_info"] = args.contact_info
                    stamp_style = TextStampStyle(stamp_text="\n".join(stamp_lines))
                else:
                    if StaticStampStyle is None:
                        raise ValueError("Custom visible signature appearances require pyHanko's stamp support")
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as appearance_file:
                        appearance_pdf_path = appearance_file.name
                    create_signature_appearance_pdf(
                        appearance_pdf_path,
                        appearance_mode,
                        args.width,
                        args.height,
                        appearance_text,
                        args.appearance_image_base64,
                        args.name or certificate_signer_name,
                        args.reason,
                        args.location,
                        canvas,
                        ImageReader,
                        Image,
                        ImageDraw,
                        ImageFont,
                    )
                    stamp_style = StaticStampStyle.from_pdf_file(
                        appearance_pdf_path,
                        border_width=0,
                        background_opacity=1.0,
                    )

                pdf_signer = signers.PdfSigner(
                    signature_meta,
                    signer=signer,
                    timestamper=timestamper,
                    stamp_style=stamp_style,
                    new_field_spec=fields.SigFieldSpec(
                        field_name,
                        on_page=page_index,
                        box=box,
                    ),
                )

                ensure_output_dir(args.output)
                with open(args.input, "rb") as input_stream:
                    writer = IncrementalPdfFileWriter(input_stream)
                    with open(args.output, "wb") as output_stream:
                        pdf_signer.sign_pdf(
                            writer,
                            output=output_stream,
                            appearance_text_params=appearance_text_params,
                        )
            finally:
                if appearance_pdf_path:
                    try:
                        os.unlink(appearance_pdf_path)
                    except OSError:
                        pass

            emit({"ok": True, "fieldName": field_name})
            return 0

        emit({"ok": False, "error": f"Unsupported command: {args.command}"})
        return 0

    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc)})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
