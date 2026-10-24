#!/usr/bin/env python3
"""PDF de análisis del clan: día anterior, última semana y último coliseo.

Lee un JSON por stdin ({kind, clan, generatedAt, tz, analysis}) y escribe el PDF en stdout.
Usa las piezas comunes de pdf_report.py y la cabecera de pdf_players.py.
"""
import io
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_report as B  # fuentes, estilos y piezas comunes
import pdf_players as P  # cabecera y pie de página
from reportlab.lib import colors
from reportlab.platypus import NextPageTemplate, Paragraph, Spacer, Table, TableStyle

S, fmt, esc, dec = B.S, B.fmt, B.esc, B.dec
CW = P.CW
GREEN, AMBER, RED, MUTED, INK = B.GREEN, B.AMBER, B.RED, B.MUTED, B.INK


def when_of(iso, tz):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(tz)


def date_txt(d):
    return f"{B.DAYS[d.weekday()]} {d.day} de {B.MONTHS[d.month - 1]}"


def signed(n):
    return f"+{fmt(n)}" if n and n > 0 else fmt(n)


def cmp_sentence(value, avg, what):
    if avg is None or not avg:
        return ''
    diff = (value - avg) / avg
    if abs(diff) < 0.01:
        return f"{what} en la media de las anteriores ({fmt(round(avg))})."
    return f"{what} un {dec(abs(diff) * 100, 1)} % {'por encima' if diff > 0 else 'por debajo'} de la media de las anteriores ({fmt(round(avg))})."


def deck_color(decks, full):
    return GREEN if decks >= full else (RED if decks == 0 else AMBER)


def players_table(players, full, days=None, show_member=True):
    head = ['#', 'Jugador', f'Mazos (de {full})'] + ([f'D{i + 1}' for i in range(days)] if days else []) + ['Medallas', 'Por mazo']
    rows = [B.hdr(head, left=2)]
    for i, p in enumerate(players, 1):
        name = esc(p['name']) + ('' if p['member'] or not show_member else ' <font color="#5E6E66">(ya no está)</font>')
        row = [str(i), Paragraph(name, S['cell']), str(p['decks'])]
        if days:
            row += [str(x) for x in (p.get('days') or [0] * days)]
        row += [fmt(p['medals'] if 'medals' in p else p['fame']) if (p.get('medals', p.get('fame')) is not None) else '—',
                fmt(round(p['perDeck'])) if p.get('perDeck') else '—']
        rows.append(row)
    fixed = [18, 0, 52] + [22] * (days or 0) + [56, 50]
    fixed[1] = CW - sum(fixed)
    t = Table(rows, colWidths=fixed, repeatRows=1)
    st = B.base_style(len(rows), numeric_from=2, pad=2.4)
    st += [('ALIGN', (0, 0), (0, -1), 'CENTER'), ('TEXTCOLOR', (0, 1), (0, -1), MUTED)]
    for r, p in enumerate(players, 1):
        st.append(('TEXTCOLOR', (2, r), (2, r), deck_color(p['decks'], full)))
        st.append(('FONTNAME', (2, r), (2, r), 'BodyB'))
        if days and p.get('days'):
            for k, x in enumerate(p['days']):
                st.append(('TEXTCOLOR', (3 + k, r), (3 + k, r), deck_color(x, 4)))
        if not p['member']:
            st.append(('TEXTCOLOR', (1, r), (1, r), MUTED))
    t.setStyle(TableStyle(st))
    return t


def build_day(data, a, doc, story):
    t = a['totals']
    story += [Paragraph(f"Día {a['day']} de batalla{' (coliseo)' if a['periodType'] == 'colosseum' else ''}", S['h2'])]
    story.append(B.kpis([
        (fmt(t['medals']), 'medallas del clan ese día' + (f" · {t['rank']}º de 5" if t['rank'] else '')),
        (f"{fmt(t['decks'])}", 'mazos jugados de 200'),
        (str(t['full']), 'jugadores con los 4 mazos'),
        (fmt(round(t['perDeck'])) if t['perDeck'] else '—', 'medallas por mazo'),
    ], CW))
    story.append(Spacer(1, 8))
    s = cmp_sentence(t['medals'], t['prevAvg'], 'El clan hizo')
    parts = [s] if s else []
    if t['none']:
        parts.append(f"{t['none']} miembros no jugaron ningún mazo y {t['partial']} lo dejaron a medias.")
    elif t['partial']:
        parts.append(f"Todos jugaron; {t['partial']} lo dejaron a medias.")
    if parts:
        story.append(Paragraph(' '.join(parts), S['call']))
    if a['clans']:
        story.append(Paragraph('Los 5 clanes ese día', S['h2']))
        rows = [B.hdr(['Puesto', 'Clan', 'Medallas', 'Avance del barco', 'Defensas en pie'], left=2)]
        own = None
        for c in a['clans']:
            rows.append([f"{c['rank']}º", Paragraph(B.rich(c['name'], c['own']), S['cellb' if c['own'] else 'cell']), fmt(c['medals']), fmt(c['progress']),
                         '—' if c['defenses'] is None else f"{c['defenses']} de 15"])
            if c['own']:
                own = len(rows) - 1
        tb = Table(rows, colWidths=[46, CW - 46 - 70 - 90 - 80, 70, 90, 80])
        tb.setStyle(TableStyle(B.base_style(len(rows), numeric_from=2, own=own)))
        story.append(tb)
    story.append(Paragraph('Jugadores', S['h2']))
    story.append(players_table(a['players'], 4))
    story.append(Spacer(1, 4))
    story.append(Paragraph('Mazos y medallas de cada jugador salen del registro diario de la Raspberry (una foto de la carrera cada pocos minutos). '
                           'Medallas: lo que sumó ese día. Verde: los 4 mazos; naranja: a medias; rojo: ninguno.', S['note']))


def build_week(data, a, doc, story):
    t = a['totals']
    col = a['colosseum']
    story.append(Paragraph(a['label'] + (' · coliseo' if col else ''), S['h2']))
    story.append(B.kpis([
        (f"{t['rank']}º de 5", f"{signed(t['trophyChange'])} trofeos de guerra"),
        (fmt(t['medals']), 'medallas del clan'),
        (fmt(t['decks']), 'mazos jugados de 800'),
        (str(t['full']), 'jugadores con los 16 mazos'),
        (fmt(round(t['perDeck'])) if t['perDeck'] else '—', 'medallas por mazo'),
    ], CW))
    story.append(Spacer(1, 8))
    parts = []
    s = cmp_sentence(t['medals'], t['prevAvg'], 'El clan hizo')
    if s:
        parts.append(s + (f" ({t['prevWeeks']} {'semanas de coliseo' if col else 'semanas normales'} en el historial)." if t['prevWeeks'] else ''))
    by_medals = sorted(a['standings'], key=lambda x: -x['medals'])
    medal_rank = next((i + 1 for i, x in enumerate(by_medals) if x['own']), None)
    if not col and medal_rank and medal_rank != t['rank']:
        parts.append(f"Fuisteis el {medal_rank}º clan en medallas pero acabasteis {t['rank']}º: en semana normal gana quien llega antes a la meta del barco.")
    if t['none']:
        parts.append(f"{t['none']} miembros no jugaron ningún mazo en toda la semana.")
    if parts:
        story.append(Paragraph(' '.join(parts), S['call']))
    story.append(Paragraph('Clasificación final', S['h2']))
    head = ['Puesto', 'Clan', 'Medallas'] + ([] if col else ['Avance']) + ['Trofeos', 'Cambio']
    rows = [B.hdr(head, left=2)]
    own = None
    for c in a['standings']:
        r = [f"{c['rank']}º", Paragraph(B.rich(c['name'], c['own']), S['cellb' if c['own'] else 'cell']), fmt(c['medals'])]
        if not col:
            r.append(fmt(c['progress']))
        r += [fmt(c['trophies']), signed(c['trophyChange'])]
        rows.append(r)
        if c['own']:
            own = len(rows) - 1
    widths = [46, 0, 70] + ([] if col else [60]) + [60, 52]
    widths[1] = CW - sum(widths)
    tb = Table(rows, colWidths=widths)
    st = B.base_style(len(rows), numeric_from=2, own=own)
    for r, c in enumerate(a['standings'], 1):
        st.append(('TEXTCOLOR', (len(widths) - 1, r), (len(widths) - 1, r), GREEN if c['trophyChange'] > 0 else RED))
    tb.setStyle(TableStyle(st))
    story.append(tb)
    story.append(Paragraph('Jugadores', S['h2']))
    story.append(players_table(a['players'], 16, days=a['days'] if a['days'] else None))
    story.append(Spacer(1, 4))
    note = 'Mazos y medallas de la semana según el historial oficial. '
    note += ('D1–D4: mazos de cada día según el registro diario de la Raspberry. ' if a['days'] else 'El desglose por día no está disponible para esta semana (no hay registro diario). ')
    note += 'Verde: todos los mazos; naranja: a medias; rojo: ninguno.'
    story.append(Paragraph(note, S['note']))


def build(data, out):
    tz = ZoneInfo(data.get('tz') or 'Europe/Madrid')
    when = when_of(data['generatedAt'], tz)
    a = data['analysis']
    clan = data['clan']
    kind = a['kind']
    if kind == 'day':
        start = when_of(a['start'], tz)
        sub = 'Análisis del día anterior'
        line2 = f"{clan['tag']}  |  Día {a['day']} de batalla, semana {a['week']} ({date_txt(start)})  |  Generado el {when:%d/%m/%Y %H:%M}"
    else:
        end = when_of(a['end'], tz) if a.get('end') else when
        sub = 'Análisis del coliseo' if kind == 'colosseum' else 'Análisis semanal'
        line2 = f"{clan['tag']}  |  {a['label']}, terminada el {date_txt(end)}  |  Generado el {when:%d/%m/%Y %H:%M}"
    doc = P.page_setup(out, clan['name'], sub, line2, when, clan)
    story = [NextPageTemplate('Later')]
    (build_day if kind == 'day' else build_week)(data, a, doc, story)
    doc.build(story)


def main():
    data = json.load(sys.stdin)
    buf = io.BytesIO()
    build(data, buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
