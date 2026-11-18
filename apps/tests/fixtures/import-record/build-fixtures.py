"""Generate small, synthetic files parsed by the actual import libraries.

Run manually with python-docx, openpyxl, reportlab and pypdf installed.
The Node test suite uses the checked-in files and needs no Python runtime.
"""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from docx import Document
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parent

document = Document()
document.add_heading('Synthetic counselor record', 1)
document.add_paragraph('课程平台显示本周缺课两次。')
document.add_paragraph('学生说其中一次请过假。')
table = document.add_table(rows=1, cols=2)
table.cell(0, 0).text = '记录来源'
table.cell(0, 1).text = '课程平台'
document.save(ROOT / 'records.docx')
Document().save(ROOT / 'empty.docx')

workbook = Workbook()
sheet = workbook.active
sheet.title = '课程记录'
sheet.append(['来源', '内容', '隐藏字段'])
sheet.append(['课程平台', '本周缺课两次', 'HIDDEN_COLUMN_SYNTHETIC'])
sheet.append(['HIDDEN_ROW_SYNTHETIC', '不应导入的隐藏行'])
sheet.row_dimensions[3].hidden = True
sheet.column_dimensions['C'].hidden = True
sheet.cell(4, 1, '=HYPERLINK("http://127.0.0.1:1/never-call", "FORMULA_SYNTHETIC")')
sheet.cell(5, 1, '次数')
sheet.cell(5, 2, 2)
hidden = workbook.create_sheet('隐藏工作表')
hidden.sheet_state = 'hidden'
hidden.append(['HIDDEN_SHEET_SYNTHETIC'])
workbook.save(ROOT / 'records.xlsx')
Workbook().save(ROOT / 'empty.xlsx')

pdf_path = ROOT / 'records.pdf'
pdf = canvas.Canvas(str(pdf_path))
pdf.drawString(50, 780, 'Synthetic course record: two absences this week.')
pdf.showPage()
pdf.drawString(50, 780, 'Student report: one absence may have approved leave.')
pdf.save()
scan_image = Image.new('RGB', (320, 100), 'white')
ImageDraw.Draw(scan_image).text((10, 20), 'Synthetic scanned image only', fill='black')
scan = canvas.Canvas(str(ROOT / 'scanned.pdf'))
scan.drawImage(ImageReader(scan_image), 40, 700, width=320, height=100)
scan.save()
empty = PdfWriter()
empty.add_blank_page(width=595, height=842)
with (ROOT / 'empty.pdf').open('wb') as target:
    empty.write(target)
encrypted = PdfWriter()
encrypted.append(PdfReader(pdf_path))
encrypted.encrypt('synthetic-password')
with (ROOT / 'encrypted.pdf').open('wb') as target:
    encrypted.write(target)

# Compressible input stays tiny on disk but exceeds the expanded per-entry budget.
with ZipFile(ROOT / 'expanded-budget.docx', 'w', compression=ZIP_DEFLATED) as zipped:
    zipped.writestr('word/document.xml', 'x' * (17 * 1024 * 1024))
with ZipFile(ROOT / 'total-budget.docx', 'w', compression=ZIP_DEFLATED) as zipped:
    for index in range(3):
        zipped.writestr(f'word/synthetic-{index}.xml', 'x' * (12 * 1024 * 1024))
with ZipFile(ROOT / 'entries-budget.xlsx', 'w', compression=ZIP_DEFLATED) as zipped:
    for index in range(2001):
        zipped.writestr(f'xl/synthetic-{index}.xml', '')

# A real OOXML archive with the encryption flag set must be rejected before parsing.
encrypted_zip = bytearray((ROOT / 'records.docx').read_bytes())
offset = 0
while offset < len(encrypted_zip) - 46:
    signature = encrypted_zip[offset:offset + 4]
    if signature == b'PK\x03\x04':
        encrypted_zip[offset + 6] |= 1
    elif signature == b'PK\x01\x02':
        encrypted_zip[offset + 8] |= 1
    offset += 1
(ROOT / 'encrypted-flag.docx').write_bytes(encrypted_zip)
