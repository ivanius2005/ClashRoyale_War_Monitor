#!/usr/bin/env python3
"""
Informe de guerra en PDF (A4) con el diseño de los informes del clan.

Lee por la entrada estándar un JSON { summary, generatedAt, tz } (el resumen de
/api/summary) y escribe el PDF por la salida estándar. Lo usa el servidor:

    GET /api/report.pdf                → PDF del momento
    informe de las 08:00               → se guarda y se adjunta al aviso de Discord

Necesita reportlab:  sudo apt install python3-reportlab   (o pip install reportlab)
"""
import glob
import io
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'fonts')

# ---------- fuentes: las del proyecto + las del sistema para símbolos raros ----------
pdfmetrics.registerFont(TTFont('Body', os.path.join(FONTS, 'DejaVuSansCondensed.ttf')))
pdfmetrics.registerFont(TTFont('BodyB', os.path.join(FONTS, 'DejaVuSansCondensed-Bold.ttf')))
pdfmetrics.registerFont(TTFont('Head', os.path.join(FONTS, 'Poppins-Bold.ttf')))
pdfmetrics.registerFont(TTFont('HeadM', os.path.join(FONTS, 'Poppins-Medium.ttf')))

FALLBACK_CANDIDATES = [
    ('Sym1', ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']),
    ('Sym2', ['/usr/share/fonts/truetype/freefont/FreeSans.ttf', '/usr/share/fonts/freefont/FreeSans.ttf']),
    ('Jp', ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf']),
    ('Cjk', ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', '/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc']),
]
FALLBACKS = []
for name, paths in FALLBACK_CANDIDATES:
    for p in paths:
        for f in glob.glob(p):
            try:
                pdfmetrics.registerFont(TTFont(name, f, subfontIndex=0) if f.endswith('.ttc') else TTFont(name, f))
                FALLBACKS.append(name)
                break
            except Exception:
                continue
        if name in FALLBACKS:
            break

def cmap(name):
    return pdfmetrics.getFont(name).face.charToGlyph
CMAPS = {n: cmap(n) for n in ['Body', 'BodyB'] + FALLBACKS}

def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def rich(text, bold=False):
    """Cada tramo del texto con la primera fuente que tenga sus caracteres."""
    chain = (['BodyB'] if bold else ['Body']) + FALLBACKS
    text = str(text).replace('\ufe0f', '').replace('\ufe0e', '')
    out, cur, buf = [], None, ''
    for ch in text:
        f = next((x for x in chain if ord(ch) in CMAPS[x]), chain[0])
        if f != cur and buf:
            out.append(f'<font name="{cur}">{esc(buf)}</font>')
            buf = ''
        cur = f
        buf += ch
    if buf:
        out.append(f'<font name="{cur}">{esc(buf)}</font>')
    return ''.join(out)

# ---------- estilo ----------
INK = colors.HexColor('#13201A'); GREEN = colors.HexColor('#169C47'); GREEN_L = colors.HexColor('#E3F4E9')
MUTED = colors.HexColor('#5E6E66'); LINE = colors.HexColor('#DCE4DF'); ZEBRA = colors.HexColor('#F4F7F5')
AMBER = colors.HexColor('#B7791F'); AMBER_L = colors.HexColor('#FFF4DB'); RED = colors.HexColor('#C8452F')
GOLD = colors.HexColor('#F2C230'); SILVER = colors.HexColor('#C9D0D6'); BRONZE = colors.HexColor('#D89A5B')
RIVAL_COLORS = [colors.HexColor(c) for c in ('#2F6FD6', '#E07A1F', '#1FA2B8', '#8A5CC2', '#C2417A')]
PODIUM = {1: GOLD, 2: SILVER, 3: BRONZE}

S = {
    'h1': ParagraphStyle('h1', fontName='Head', fontSize=16, leading=20, textColor=INK, spaceAfter=2),
    'sub': ParagraphStyle('sub', fontName='Body', fontSize=9.2, leading=12.5, textColor=MUTED, spaceAfter=8),
    'h2': ParagraphStyle('h2', fontName='Head', fontSize=11.5, leading=15, textColor=INK, spaceBefore=8, spaceAfter=4),
    'h3': ParagraphStyle('h3', fontName='Head', fontSize=10.5, leading=13, textColor=INK, spaceAfter=2),
    'p': ParagraphStyle('p', fontName='Body', fontSize=9.4, leading=13.2, textColor=INK, spaceAfter=4),
    'note': ParagraphStyle('note', fontName='Body', fontSize=7.8, leading=10.5, textColor=MUTED),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.4, leading=10.2, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='BodyB', fontSize=8.4, leading=10.2, textColor=INK),
    'kpiv': ParagraphStyle('kpiv', fontName='Head', fontSize=17, leading=20, textColor=INK),
    'kpil': ParagraphStyle('kpil', fontName='Body', fontSize=7.8, leading=10, textColor=MUTED),
    'big': ParagraphStyle('big', fontName='Head', fontSize=15, leading=18, textColor=INK),
    'call': ParagraphStyle('call', fontName='Body', fontSize=9.6, leading=13.5, textColor=INK),
}
DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

def fmt(n):
    return '—' if n is None else f'{round(n):,}'.replace(',', '.')

def pct(p):
    if p is None:
        return '—'
    if 0 < p < 0.005:
        return '<1 %'
    return f'{round(p * 100)} %'

def dec(x, d=1):
    return '—' if x is None else f'{x:.{d}f}'.replace('.', ',')

def mix(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return colors.Color(c1.red + (c2.red - c1.red) * t, c1.green + (c2.green - c1.green) * t, c1.blue + (c2.blue - c1.blue) * t)

# ---------- piezas visuales ----------
class Dot(Flowable):
    def __init__(self, color, size=7):
        super().__init__(); self.color, self.size = color, size
    def wrap(self, *a):
        return self.size, self.size
    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.circle(self.size / 2, self.size / 2, self.size / 2, stroke=0, fill=1)

class River(Flowable):
    """Carrera normal: cada clan es una franja de 0 a 10.000 con la meta al final."""
    def __init__(self, clans, colors_by_tag, width):
        super().__init__(); self.clans, self.col, self.w = clans, colors_by_tag, width
        self.row = 23; self.h = self.row * len(clans) + 22
    def wrap(self, *a):
        return self.w, self.h
    def draw(self):
        c = self.canv; label_w, val_w = 112, 50
        tx, tw = label_w, self.w - label_w - val_w
        for v in (2500, 5000, 7500):
            xx = tx + tw * v / 10000
            c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(xx, 4, xx, self.h - 13)
            c.setFont('Body', 7); c.setFillColor(MUTED); c.drawCentredString(xx, self.h - 9, fmt(v))
        for i, cl in enumerate(self.clans):
            y = self.h - 18 - (i + 1) * self.row + 6
            col = self.col[cl['tag']]
            c.setFont('BodyB' if cl['own'] else 'Body', 8.8); c.setFillColor(INK)
            c.drawString(0, y + 4, cl['name'][:22])
            c.setFillColor(colors.HexColor('#E8EEF0')); c.roundRect(tx, y, tw, 13, 6.5, stroke=0, fill=1)
            frac = min(1, (cl['progress'] or 0) / 10000)
            c.setFillColor(col); c.roundRect(tx, y, max(13, tw * frac), 13, 6.5, stroke=0, fill=1)
            bx = tx + tw * frac
            c.setFillColor(colors.white); c.setStrokeColor(col); c.setLineWidth(1.4); c.circle(bx, y + 6.5, 6, stroke=1, fill=1)
            c.setFillColor(col); c.circle(bx, y + 6.5, 2.4, stroke=0, fill=1)
            c.setFont('BodyB' if cl['own'] else 'Body', 8.8); c.setFillColor(INK)
            c.drawRightString(self.w, y + 4, fmt(cl['progress']))
        c.setStrokeColor(INK); c.setLineWidth(1.2); c.setDash(3, 2); c.line(tx + tw, 4, tx + tw, self.h - 12); c.setDash()
        c.setFont('BodyB', 7.5); c.setFillColor(INK); c.drawCentredString(tx + tw, self.h - 9, 'META 10.000')

class HBars(Flowable):
    """Barras horizontales por clan (medallas, mazos…)."""
    def __init__(self, title, items, width, vmax=None, suffix=''):
        super().__init__(); self.title, self.items, self.w, self.suffix = title, items, width, suffix
        self.vmax = vmax or max([v for _, v, _, _ in items] + [1])
        self.row = 17; self.h = self.row * len(items) + 18
    def wrap(self, *a):
        return self.w, self.h
    def draw(self):
        c = self.canv
        c.setFont('BodyB', 8.4); c.setFillColor(INK); c.drawString(0, self.h - 10, self.title)
        label_w, val_w = 92, 52
        tw = self.w - label_w - val_w
        for i, (name, v, col, own) in enumerate(self.items):
            y = self.h - 18 - (i + 1) * self.row + 4
            c.setFont('BodyB' if own else 'Body', 8); c.setFillColor(INK); c.drawString(0, y + 2, name[:17])
            c.setFillColor(colors.HexColor('#E8EEF0')); c.rect(label_w, y, tw, 9, stroke=0, fill=1)
            c.setFillColor(col); c.rect(label_w, y, tw * min(1, (v or 0) / self.vmax), 9, stroke=0, fill=1)
            c.setFont('BodyB' if own else 'Body', 8); c.setFillColor(INK)
            c.drawRightString(self.w, y + 2, fmt(v) + self.suffix)

def clan_cell(cl, col):
    t = Table([[Dot(col), Paragraph(rich(cl['name'], cl['own']), S['cellb' if cl['own'] else 'cell'])]], colWidths=[11, None])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0),
                           ('RIGHTPADDING', (0, 0), (-1, -1), 2), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    return t

def base_style(n, numeric_from=1, own=None, pad=3.2):
    st = [('FONTNAME', (0, 0), (-1, -1), 'Body'), ('FONTSIZE', (0, 0), (-1, -1), 8.4),
          ('FONTNAME', (0, 0), (-1, 0), 'BodyB'), ('FONTSIZE', (0, 0), (-1, 0), 7.3),
          ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('BACKGROUND', (0, 0), (-1, 0), INK),
          ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (numeric_from, 0), (-1, -1), 'RIGHT'),
          ('TOPPADDING', (0, 0), (-1, -1), pad), ('BOTTOMPADDING', (0, 0), (-1, -1), pad),
          ('LEFTPADDING', (0, 0), (-1, -1), 4.5), ('RIGHTPADDING', (0, 0), (-1, -1), 4.5),
          ('LINEBELOW', (0, 1), (-1, -1), 0.4, LINE)]
    for r in range(1, n):
        if r % 2 == 0:
            st.append(('BACKGROUND', (0, r), (-1, r), ZEBRA))
    if own:
        st += [('BACKGROUND', (0, own), (-1, own), GREEN_L), ('FONTNAME', (1, own), (-1, own), 'BodyB')]
    return st

HDR = ParagraphStyle('hdr', fontName='BodyB', fontSize=7.2, leading=8.6, textColor=colors.white, alignment=2)
HDR_L = ParagraphStyle('hdrl', parent=HDR, alignment=0)

def hdr(texts, left=1):
    """Cabeceras que pueden partirse en dos líneas (las primeras `left` alineadas a la izquierda)."""
    return [Paragraph(esc(t), HDR_L if i < left else HDR) for i, t in enumerate(texts)]

def kpis(items, width):
    cells = [[Paragraph(v, S['kpiv']), Paragraph(l, S['kpil'])] for v, l in items]
    t = Table([cells], colWidths=[width / len(items)] * len(items))
    t.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.6, LINE), ('INNERGRID', (0, 0), (-1, -1), 0.6, LINE),
                           ('BACKGROUND', (0, 0), (-1, -1), ZEBRA), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                           ('LEFTPADDING', (0, 0), (-1, -1), 10)]))
    return t

# ---------- informe ----------
def build(data, out):
    s = data['summary']
    tz = ZoneInfo(data.get('tz') or 'Europe/Madrid')
    when = datetime.fromisoformat(data['generatedAt'].replace('Z', '+00:00')).astimezone(tz)
    when_txt = f"{DAYS[when.weekday()]} {when.day} de {MONTHS[when.month - 1]} de {when.year}, {when:%H:%M}"
    race = s['race']
    clans = s['clans']
    own = next((c for c in clans if c['own']), clans[0])
    own_name = own['name']
    col = {}
    k = 0
    for c in clans:
        if c['own']:
            col[c['tag']] = GREEN
        else:
            col[c['tag']] = RIVAL_COLORS[k % len(RIVAL_COLORS)]; k += 1
    monthly = s.get('monthly') or {}
    season = (monthly.get('current') or {}).get('seasonId')
    W, H = A4
    CW = W - 72

    def on_page(c, doc):
        c.saveState()
        if doc.page == 1:
            c.setFillColor(INK); c.rect(0, H - 118, W, 118, stroke=0, fill=1)
            c.setFillColor(GREEN); c.rect(0, H - 121, W, 3, stroke=0, fill=1)
            c.setFillColor(colors.white); c.setFont('Head', 27); c.drawString(36, H - 60, own_name)
            c.setFont('HeadM', 11); c.setFillColor(colors.HexColor('#9FD9B3'))
            parts = ['Informe de guerra']
            if season:
                parts.append(f"Temporada {season}, semana {race['week']}")
            parts.append(race['label'])
            c.drawString(36, H - 82, '  |  '.join(parts))
            c.setFont('Body', 9); c.setFillColor(colors.HexColor('#C9D6CF'))
            c.drawString(36, H - 100, f"{own['tag']}  |  Situación del {when_txt} (hora de España)")
        c.setFont('Body', 7.4); c.setFillColor(MUTED)
        c.drawString(36, 22, f"{own_name} {own['tag']}  |  Datos de la API oficial de Clash Royale  |  {when:%d/%m/%Y %H:%M}")
        c.drawRightString(W - 36, 22, f'Página {doc.page}')
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(36, 32, W - 36, 32)
        c.restoreState()

    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=40, bottomMargin=46,
                          title=f'{own_name}: informe de guerra ({when:%d/%m/%Y %H:%M})', author=own_name)
    doc.addPageTemplates([PageTemplate(id='First', frames=[Frame(36, 46, CW, H - 46 - 136)], onPage=on_page),
                          PageTemplate(id='Later', frames=[Frame(36, 46, CW, H - 46 - 40)], onPage=on_page)])
    story = [NextPageTemplate('Later')]

    # ===== Página 1: la semana =====
    others = [c for c in clans if not c['own']]
    ref = others[0] if own['position'] == 1 and others else next((c for c in clans if not c['own'] and c['position'] == 1), None)
    wk = own.get('week') or {}
    if race['colosseum']:
        gap_txt = f"{'+' if (own.get('weekMedals') or 0) >= (ref.get('weekMedals') or 0) else '−'}{fmt(abs((own.get('weekMedals') or 0) - (ref.get('weekMedals') or 0)))} medallas con {ref['name']}" if ref else ''
    else:
        gap_txt = f"{'+' if own['progress'] >= ref['progress'] else '−'}{fmt(abs(own['progress'] - ref['progress']))} de avance con {ref['name']}" if ref else ''
    win_sub = f"ganar la semana · solos {pct(wk.get('pWinAlone'))}, empatados {pct(wk.get('pTieFirst'))}" if (wk.get('pTieFirst') or 0) > 0.01 else 'probabilidad de ganar la semana'
    items = [(f"{own['position']}º", f'puesto ahora · {gap_txt}' if gap_txt else 'puesto ahora'),
             (pct(wk.get('pFirst')), win_sub)]
    if race['training']:
        items += [('—', 'días de entrenamiento: la carrera empieza el jueves'), (dec(wk.get('expectedRank')), 'puesto esperado al final')]
    else:
        left = (s.get('own') or {}).get('decksLeft', own['decksLeft'])
        items += [(f"{own['decksToday']}/200", f"mazos jugados hoy · faltan {left}" if left else 'mazos jugados hoy: todos'),
                  (fmt(own['medalsToday']), f"medallas hoy · previsión {fmt((own.get('today') or {}).get('expected'))}")]
    story += [kpis(items, CW), Spacer(1, 10)]

    # Resumen en una frase
    lines = []
    if race['training']:
        lines.append(f"Estamos en días de entrenamiento. Con lo que han jugado los cinco clanes en sus últimas semanas, "
                     f"tenemos un <b>{pct(wk.get('pFirst'))}</b> de ganar la semana.")
    else:
        pos_txt = f"Vamos <b>{own['position']}º</b>" + (f" ({gap_txt})" if gap_txt else '')
        lines.append(f"{pos_txt}. Opciones de ganar la semana: <b>{pct(wk.get('pFirst'))}</b>"
                     + (f" ({pct(wk.get('pWinAlone'))} solos y {pct(wk.get('pTieFirst'))} empatados en la meta)" if (wk.get('pTieFirst') or 0) > 0.01 else '') + '.')
        lo = s.get('own') or {}
        if lo.get('decksLeft'):
            lines.append(f"Hoy llevamos {fmt(own['medalsToday'])} medallas y {own['decksToday']} de 200 mazos: "
                         f"<b>faltan {lo['decksLeft']} mazos de {lo['playersPending']} jugadores</b> (lista en la página 3).")
        else:
            lines.append(f"Hoy llevamos {fmt(own['medalsToday'])} medallas y los 200 mazos jugados.")
    story += [Paragraph('En resumen', S['h2']), Paragraph(' '.join(lines), S['p'])]

    if not race['colosseum'] and not race['training']:
        story += [Paragraph('La carrera', S['h2']), River(clans, col, CW), Spacer(1, 2),
                  Paragraph('Puntos de avance. Cada día, el orden por medallas da 3.000, 1.800, 1.000, 600 o 400 puntos, '
                            'más el extra de las defensas del barco que siguen en pie.', S['note'])]
    elif race['colosseum']:
        story += [Paragraph('El coliseo', S['h2']),
                  HBars('Medallas de la semana', [(c['name'], c.get('weekMedals') or 0, col[c['tag']], c['own']) for c in clans], CW)]

    # Probabilidad de cada puesto
    n = len(clans)
    story += [Paragraph('Probabilidad de terminar la semana en cada puesto', S['h2'])]
    head = ['Clan'] + [f'{i + 1}º' for i in range(n)] + ['Gana solo', 'Empate 1º', 'Puesto esp.']
    rows = [head]
    ordered = sorted(clans, key=lambda c: (c.get('week') or {}).get('expectedRank', 9))
    for c in ordered:
        w = c.get('week') or {}
        p = w.get('p') or [None] * n
        rows.append([clan_cell(c, col[c['tag']])] + [pct(v) for v in p] + [pct(w.get('pWinAlone')), pct(w.get('pTieFirst')), dec(w.get('expectedRank'))])
    t = Table(rows, colWidths=[128] + [42] * n + [52, 52, CW - 128 - 42 * n - 104], repeatRows=1)
    st = base_style(len(rows), own=1 + [c['own'] for c in ordered].index(True))
    for r, c in enumerate(ordered, 1):
        for i, v in enumerate((c.get('week') or {}).get('p') or []):
            if v is None:
                continue
            st.append(('BACKGROUND', (1 + i, r), (1 + i, r), mix(colors.white, GREEN, v * 0.95)))
            st.append(('TEXTCOLOR', (1 + i, r), (1 + i, r), colors.white if v > 0.5 else INK))
            st.append(('ALIGN', (1 + i, r), (1 + i, r), 'CENTER'))
    st += [('ALIGN', (1, 0), (n, 0), 'CENTER'), ('LINEBEFORE', (n + 1, 0), (n + 1, -1), 0.8, LINE)]
    t.setStyle(TableStyle(st))
    story += [t, Spacer(1, 3),
              Paragraph(f"{fmt(s.get('runs'))} simulaciones con el historial de cada clan y lo que lleva esta semana. "
                        "Si dos clanes cruzan la meta el mismo día, comparten el 1º («empate»).", S['note']),
              PageBreak()]

    # ===== Página 2: los clanes y el miembro del mes =====
    story += [Paragraph('Los clanes ahora mismo', S['h1']),
              Paragraph(f'Medallas, mazos y ataques de los {n} clanes de la carrera el {when_txt}.', S['sub'])]
    rows = [hdr(['#', 'Clan', 'Avance' if not race['colosseum'] else 'Medallas', 'Medallas hoy', 'Mazos hoy', 'Faltan',
                 'Medallas semana', 'Mazos semana', 'Por mazo', 'Ataques barco', 'Defensas'], left=2)]
    for c in clans:
        rows.append([str(c['position']), clan_cell(c, col[c['tag']]),
                     fmt(c['weekMedals'] if race['colosseum'] else c['progress']), fmt(c['medalsToday']),
                     f"{c['decksToday']}/200", str(c['decksLeft']), fmt(c.get('weekMedals')), fmt(c.get('weekDecks')),
                     dec(c.get('perDeck')), fmt(c.get('boatAttacks')), '—' if c.get('defenses') is None else str(c['defenses'])])
    t = Table(rows, colWidths=[16, 102, 46, 50, 46, 34, 52, 44, 40, 42, CW - 472], repeatRows=1)
    st = base_style(len(rows), numeric_from=2, own=1 + [c['own'] for c in clans].index(True))
    st += [('ALIGN', (0, 0), (0, -1), 'CENTER')]
    for r, c in enumerate(clans, 1):
        if c['decksLeft'] and not race['training']:
            st.append(('TEXTCOLOR', (5, r), (5, r), AMBER))
    t.setStyle(TableStyle(st))
    story += [t, Spacer(1, 3),
              Paragraph('«Ataques barco»: batallas contra barcos rivales en la semana. «Defensas»: defensas del barco '
                        'en pie al cerrar el último día (cada una suma avance a diario y no vuelve hasta la semana siguiente).', S['note']),
              Spacer(1, 10)]
    if not race['training']:
        half = (CW - 16) / 2
        b1 = HBars('Medallas de hoy', [(c['name'], c['medalsToday'], col[c['tag']], c['own']) for c in clans], half)
        b2 = HBars('Mazos jugados hoy (de 200)', [(c['name'], c['decksToday'], col[c['tag']], c['own']) for c in clans], half, vmax=200)
        bars = Table([[b1, b2]], colWidths=[half + 16, half])
        bars.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
        story += [bars, Spacer(1, 12)]

    # Miembro del mes
    story.append(Paragraph('Miembro del mes', S['h2']))
    if monthly and (monthly.get('current') or monthly.get('previous')):
        def card(block, title, subtitle, final):
            top = (block or {}).get('top') or []
            items = [Paragraph(title, S['h3']), Paragraph(subtitle, S['note']), Spacer(1, 6)]
            if not top:
                items.append(Paragraph('Sin datos todavía.', S['p']))
                return items
            leader = top[0]
            items.append(Paragraph(rich(leader['name'], True), S['big']))
            items.append(Paragraph(f"{fmt(leader['medals'])} medallas · {leader['decks']} mazos · {leader['weeks']} semanas"
                                   + ('' if leader.get('member', True) else ' · ya no está en el clan'), S['note']))
            items.append(Spacer(1, 6))
            rows = [['#', 'Jugador', 'Medallas', 'Mazos']]
            for e in top[:5]:
                rows.append([str(e['rank']), Paragraph(rich(e['name']) + ('' if e.get('member', True) else ' <font size="6.5" color="#5E6E66">(ya no está)</font>'), S['cell']),
                             fmt(e['medals']), str(e['decks'])])
            tt = Table(rows, colWidths=[18, None, 52, 38])
            st = base_style(len(rows), numeric_from=2, pad=2.6)
            st += [('ALIGN', (0, 0), (0, -1), 'CENTER'), ('FONTNAME', (0, 1), (0, -1), 'BodyB')]
            for r, e in enumerate(top[:5], 1):
                if e['rank'] in PODIUM:
                    st.append(('BACKGROUND', (0, r), (0, r), PODIUM[e['rank']]))
            tt.setStyle(TableStyle(st))
            items.append(tt)
            return items
        cur, prev = monthly.get('current') or {}, monthly.get('previous') or {}
        c1 = card(cur, f"Temporada {cur.get('seasonId')} · en curso",
                  f"{cur.get('weeksCounted', 0)} semana(s) contadas, incluida la actual. Puede cambiar hasta que acabe el mes.", False)
        prev_sub = f"Final: {prev.get('weeksCounted', 0)} semanas." if prev.get('complete') else \
            f"Solo hay {prev.get('weeksCounted', 0)} semana(s) de esa temporada en el historial."
        c2 = card(prev, f"Temporada {prev.get('seasonId')} · terminada", prev_sub, True)
        half = (CW - 16) / 2
        cards = Table([[c1, c2]], colWidths=[half + 8, half + 8])
        cards.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOX', (0, 0), (0, 0), 0.6, LINE), ('BOX', (1, 0), (1, 0), 0.6, LINE),
                                   ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#FBFCFB')), ('BACKGROUND', (1, 0), (1, 0), colors.HexColor('#FFFCF2')),
                                   ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                                   ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 10)]))
        story += [cards, Spacer(1, 3), Paragraph('Quien más medallas suma en la temporada (cada temporada dura un mes). '
                                                  'A igualdad de medallas, va delante quien usó menos mazos.', S['note'])]
    else:
        story.append(Paragraph('No hay historial suficiente para calcularlo.', S['p']))
    story.append(PageBreak())

    # ===== Página 3: nuestros jugadores =====
    pl = s.get('players') or {}
    lst = pl.get('list') or []
    members = [p for p in lst if p['member']]
    story += [Paragraph('Nuestros jugadores', S['h1']),
              Paragraph(f'{len(members)} miembros. Ordenados por medallas de la semana. Hoy: mazos jugados (x/4).', S['sub'])]
    pend = [p for p in members if p['today']['left'] > 0] if not race['training'] else []
    if pend:
        names = ', '.join(f"{rich(p['name'])} <b>({p['today']['left']})</b>" for p in sorted(pend, key=lambda p: (-p['today']['left'], p['name'].lower())))
        call = Table([[Paragraph(f'<font name="Head" size="11.5">Faltan {sum(p["today"]["left"] for p in pend)} mazos de {len(pend)} jugadores</font><br/>{names}', S['call'])]], colWidths=[CW])
        call.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), AMBER_L), ('LINEBEFORE', (0, 0), (0, -1), 4, AMBER),
                                  ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
                                  ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 9)]))
        story += [call, Spacer(1, 10)]
    labels = pl.get('weekLabels') or []
    head = ['#', 'Jugador', 'Hoy', 'Mazos', 'Medallas', 'Por día', 'Por mazo'] + (['Sem. −1', 'Media ant.'] if labels else [])
    rows = [head]
    shown = members + [p for p in lst if not p['member']]
    for i, p in enumerate(shown, 1):
        name = rich(p['name']) + (f' <font size="6.5" color="#5E6E66">{esc(p.get("role") or "")}</font>' if p['member'] else ' <font size="6.5" color="#5E6E66">ya no está</font>')
        row = [str(i), Paragraph(name, S['cell']), '—' if race['training'] else f"{p['today']['decks']}/4",
               f"{p['week']['decks']}/16", fmt(p['week']['medals']), fmt(p['week'].get('perDay')), fmt(p['week'].get('perDeck'))]
        if labels:
            prev0 = (p.get('prev') or [None])[0]
            row += [fmt(prev0['medals']) if prev0 else '—', fmt(p.get('prevAvg'))]
        rows.append(row)
    widths = [20, 150, 36, 44, 56, 50, 50] + ([56, CW - 462] if labels else [])
    if not labels:
        widths[1] += CW - sum(widths)
    t = Table(rows, colWidths=widths, repeatRows=1)
    st = base_style(len(rows), numeric_from=2, pad=2.4)
    st += [('ALIGN', (0, 0), (0, -1), 'CENTER'), ('TEXTCOLOR', (0, 1), (0, -1), MUTED), ('FONTNAME', (4, 1), (4, -1), 'BodyB')]
    for r, p in enumerate(shown, 1):
        if not p['member']:
            st.append(('TEXTCOLOR', (1, r), (-1, r), MUTED))
        elif not race['training'] and p['today']['left'] > 0:
            st.append(('TEXTCOLOR', (2, r), (2, r), AMBER)); st.append(('FONTNAME', (2, r), (2, r), 'BodyB'))
    t.setStyle(TableStyle(st))
    story += [t, Spacer(1, 4),
              Paragraph('Por día: medallas por día jugado esta semana. Sem. −1: medallas de la semana anterior'
                        + (f' ({esc(labels[0])})' if labels else '') + '. Media ant.: media de las semanas anteriores en que jugó.', S['note'])]
    doc.build(story)


def main():
    data = json.load(sys.stdin)
    buf = io.BytesIO()
    build(data, buf)
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'wb') as f:
            f.write(buf.getvalue())
    else:
        sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
