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


REL_COLOR = {'Alta': GREEN, 'Media': AMBER, 'Baja': RED}


def times_txt(times, tz):
    # [[ms, mazos tras el cambio, aproximado]] → «≤10:02 ×2 · 21:40 ×2»
    out, prev = [], 0
    for ms, count, approx in times or []:
        t = datetime.fromtimestamp(ms / 1000, tz)
        n = count - prev
        prev = count
        out.append(f"{'≤' if approx else ''}{t:%H:%M}{f' ×{n}' if n > 1 else ''}")
    return ' · '.join(out)


def players_table(players, full, days=None, show_member=True, tz=None, hours=False):
    head = ['#', 'Jugador', f'Mazos (de {full})'] + ([f'D{i + 1}' for i in range(days)] if days else []) + ['Medallas', 'Por mazo', 'Fiab.'] + (['Horas'] if hours else [])
    rows = [B.hdr(head, left=2)]
    for i, p in enumerate(players, 1):
        name = esc(p['name']) + ('' if p['member'] or not show_member else ' <font color="#5E6E66">(ya no está)</font>')
        row = [str(i), Paragraph(name, S['cell']), str(p['decks'])]
        if days:
            row += [str(x) for x in (p.get('days') or [0] * days)]
        rel = p.get('reliability') or {}
        row += [fmt(p['medals'] if 'medals' in p else p['fame']) if (p.get('medals', p.get('fame')) is not None) else '—',
                fmt(round(p['perDeck'])) if p.get('perDeck') else '—',
                str(rel['index']) if rel.get('index') is not None else '—']
        if hours:
            row.append(Paragraph(times_txt(p.get('times'), tz) or '—', S['cell']))
        rows.append(row)
    fixed = [18, 0, 52] + [22] * (days or 0) + [56, 50, 34] + ([120] if hours else [])
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
        rel = p.get('reliability') or {}
        if rel.get('label') in REL_COLOR:
            c = 3 + (days or 0) + 2
            st += [('TEXTCOLOR', (c, r), (c, r), REL_COLOR[rel['label']]), ('FONTNAME', (c, r), (c, r), 'BodyB')]
    if hours:
        st.append(('ALIGN', (len(head) - 1, 0), (len(head) - 1, -1), 'LEFT'))
    t.setStyle(TableStyle(st))
    return t


REL_NOTE = ('Fiab.: índice de fiabilidad (0-100) con su nota de «Expulsiones» (50 %), la estabilidad de sus medallas semana a semana (25 %) '
            'y las semanas seguidas en el clan (25 %). Verde: alta (≥ 75); naranja: media (50-74); rojo: baja.')


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
    has_times = any(p.get('times') for p in a['players'])
    story.append(players_table(a['players'], 4, tz=ZoneInfo(data.get('tz') or 'Europe/Madrid'), hours=has_times))
    story.append(Spacer(1, 4))
    story.append(Paragraph('Mazos y medallas de cada jugador salen del registro diario de la Raspberry (una foto de la carrera cada 10 minutos). '
                           'Medallas: lo que sumó ese día. Verde: los 4 mazos; naranja: a medias; rojo: ninguno. '
                           + ('Horas: cuándo jugó sus mazos (con un margen de 10 minutos; ×2 = dos mazos en ese rato; ≤ = antes de esa hora). ' if has_times else
                              'Las horas de los ataques se registran desde esta versión: saldrán en los próximos días. ') + REL_NOTE, S['note']))


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
    note += 'Verde: todos los mazos; naranja: a medias; rojo: ninguno. ' + REL_NOTE
    story.append(Paragraph(note, S['note']))


APT_COLOR = {'bien': GREEN, 'vigilar': AMBER, 'expulsar': RED, 'nuevo': MUTED}


def build_playerwar(data, a, doc, story):
    e = a.get('evaluation') or {}
    home = a.get('home') or {}
    known = [w for w in a['weeks'] if w['known']]
    played = [w for w in known if w['decks'] > 0]
    hn = home.get('name') or 'el clan'
    col = APT_COLOR.get(e.get('verdict'), MUTED)
    verdict = e.get('apt') or 'Sin datos suficientes'
    story.append(Paragraph(f'Evaluación para {esc(hn)}', S['h2']))
    story.append(Paragraph(f'<font size="20" color="{col.hexval().replace("0x", "#")}"><b>{esc(verdict)}</b></font>', S['p']))
    story.append(Spacer(1, 6))
    avg_m = sum(w['medals'] for w in known) / len(known) if known else None
    avg_d = sum(w['decks'] for w in known) / len(known) if known else None
    story.append(B.kpis([
        (dec(e['score'], 2) if e.get('score') is not None else '—', 'nota (expulsar < ' + dec((e.get('rules') or {}).get('threshold', -0.5), 1) + ')'),
        (fmt(round(avg_m)) if avg_m is not None else '—', 'medallas por semana'),
        (dec(avg_d, 1) if avg_d is not None else '—', 'mazos por semana (de 16)'),
        (f"{a['known']} de 10", 'semanas con datos'),
        ((str(e['reliability']['index']) + ' · ' + e['reliability']['label']) if (e.get('reliability') or {}).get('index') is not None else '—', 'fiabilidad (0-100)'),
    ], CW))
    story.append(Spacer(1, 8))
    parts = []
    if home.get('avgMedals') and avg_m is not None:
        diff = (avg_m - home['avgMedals']) / home['avgMedals']
        parts.append(f"El jugador medio de {esc(hn)} hace {fmt(round(home['avgMedals']))} medallas y {dec(home['avgDecks'], 1)} mazos por semana; "
                     f"este jugador, un {dec(abs(diff) * 100, 0)} % {'más' if diff >= 0 else 'menos'} de medallas.")
    if a['known'] < 10:
        parts.append(f"Faltan {10 - a['known']} semanas: la API oficial no da el historial de un jugador, solo el de cada clan, "
                     "y no se sabe en qué clan estuvo esas semanas.")
    if e.get('verdict') == 'nuevo' or not e:
        parts.append('Con menos de 4 semanas de datos no se puede evaluar.')
    if parts:
        story.append(Paragraph(' '.join(parts), S['call']))
    story.append(Paragraph('Últimas 10 semanas de guerra', S['h2']))
    rows = [B.hdr(['Semana', 'Clan', 'Mazos (de 16)', 'Medallas', 'Por mazo'], left=2)]
    for w in a['weeks']:
        lab = (w.get('label') or w['date']) + (' · coliseo' if w.get('colosseum') else '')
        if w['known']:
            rows.append([lab, Paragraph(esc(w['clan']['name']), S['cell']), str(w['decks']), fmt(w['medals']), fmt(round(w['medals'] / w['decks'])) if w['decks'] else '—'])
        else:
            rows.append([lab, Paragraph('<font color="#5E6E66">sin datos</font>', S['cell']), '—', '—', '—'])
    t = Table(rows, colWidths=[120, CW - 120 - 80 - 70 - 60, 80, 70, 60])
    st = B.base_style(len(rows), numeric_from=2)
    for i, w in enumerate(a['weeks'], 1):
        if w['known']:
            st.append(('TEXTCOLOR', (2, i), (2, i), GREEN if w['decks'] >= 16 else (RED if w['decks'] == 0 else AMBER)))
            st.append(('FONTNAME', (2, i), (2, i), 'BodyB'))
        else:
            st.append(('TEXTCOLOR', (0, i), (-1, i), MUTED))
    t.setStyle(TableStyle(st))
    story.append(t)
    r = e.get('rules') or {}
    if r:
        c = r['coef']
        story.append(Spacer(1, 8))
        story.append(Paragraph('Cómo se calcula', S['h2']))
        story.append(Paragraph(
            f"Son los requisitos de {esc(hn)} en «Expulsiones» (valores por defecto). Nota = media de los días de guerra (los 4 mazos {dec(c[4], 2)}; 3: {dec(c[3], 2)}; "
            f"2: {dec(c[2], 2)}; 1: {dec(c[1], 2)}; ninguno: {dec(c[0], 2)}) + 0,5 + (medallas por semana − {fmt(r['medalTarget'])}) × 0,001. "
            f"Bien (apto) por encima de {dec(r['watchUpTo'], 1)}; a revisar entre {dec(r['threshold'], 1)} y {dec(r['watchUpTo'], 1)}; "
            f"no apto por debajo de {dec(r['threshold'], 1)}. Hacen falta {r['minWeeks']} semanas con datos. "
            f"Nota de mazos: {dec(e.get('deckScore'), 2)} · nota de medallas: {dec(e.get('medalScore'), 2)}.", S['note']))
        rl = e.get('reliability') or {}
        if rl.get('index') is not None:
            pct = lambda x: '—' if x is None else f"{round(x * 100)} %"
            story.append(Paragraph(
                f"Fiabilidad {rl['index']} ({rl['label']}): nota {pct(rl.get('nota'))} (cuenta el 50 %), estabilidad de sus medallas {pct(rl.get('estabilidad'))} (25 %) "
                f"y {rl.get('streak', 0)} semanas seguidas en el mismo clan (25 %); {rl.get('clans', 0)} clan{'es' if rl.get('clans', 0) != 1 else ''} distinto{'s' if rl.get('clans', 0) != 1 else ''} en estas semanas.", S['note']))


def build(data, out):
    tz = ZoneInfo(data.get('tz') or 'Europe/Madrid')
    when = when_of(data['generatedAt'], tz)
    a = data['analysis']
    clan = data['clan']
    kind = data.get('kind') or a['kind']
    if kind == 'playerwar':
        cl = a.get('clan') or {}
        sub = 'Historial de guerra · últimas 10 semanas'
        line2 = f"{a['tag']}  |  {('Clan actual: ' + cl['name']) if cl.get('name') else 'Sin clan'}  |  Generado el {when:%d/%m/%Y %H:%M}"
    elif kind == 'day':
        start = when_of(a['start'], tz)
        sub = 'Análisis del día anterior'
        line2 = f"{clan['tag']}  |  Día {a['day']} de batalla, semana {a['week']} ({date_txt(start)})  |  Generado el {when:%d/%m/%Y %H:%M}"
    else:
        end = when_of(a['end'], tz) if a.get('end') else when
        sub = 'Análisis del coliseo' if kind == 'colosseum' else 'Análisis semanal'
        line2 = f"{clan['tag']}  |  {a['label']}, terminada el {date_txt(end)}  |  Generado el {when:%d/%m/%Y %H:%M}"
    doc = P.page_setup(out, clan['name'], sub, line2, when, clan)
    story = [NextPageTemplate('Later')]
    {'day': build_day, 'playerwar': build_playerwar}.get(kind, build_week)(data, a, doc, story)
    doc.build(story)


def main():
    data = json.load(sys.stdin)
    buf = io.BytesIO()
    build(data, buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
