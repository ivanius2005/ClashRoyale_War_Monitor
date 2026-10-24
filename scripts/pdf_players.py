#!/usr/bin/env python3
"""
PDF del desempeño de los jugadores (mismo diseño que el informe de guerra).

Entrada (stdin): { mode: 'clan' | 'player', report, tag?, generatedAt, tz }
  clan   → candidatos a expulsión, quién mejora / empeora y ranking de las 10 semanas
  player → ficha de un jugador: sus 10 semanas frente a la media del clan
Salida: el PDF por stdout.
"""
import io
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_report as B  # fuentes, estilos y piezas comunes
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, NextPageTemplate, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle, KeepTogether)

S, fmt, pct, dec, rich, esc = B.S, B.fmt, B.pct, B.dec, B.rich, B.esc
INK, GREEN, MUTED, LINE, ZEBRA = B.INK, B.GREEN, B.MUTED, B.LINE, B.ZEBRA
GOLD = colors.HexColor('#E3A916')      # medallas (toque Clash)
GOLD_L = colors.HexColor('#FFF4D6')
RED, AMBER = B.RED, B.AMBER
VERDICT = {'expulsar': ('Expulsar', RED), 'vigilar': ('Vigilar', AMBER), 'bien': ('Bien', GREEN), 'nuevo': ('Nuevo', MUTED)}
TREND = {'mejora': ('▲ mejora', GREEN), 'empeora': ('▼ empeora', RED), 'estable': ('= estable', MUTED), 'pocos datos': ('pocos datos', MUTED)}
DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
W, H = A4
CW = W - 72


class Spark(Flowable):
    """Minigráfica de 10 semanas (de la más antigua a la más reciente)."""
    def __init__(self, series, vmax, width=78, height=15):
        super().__init__(); self.s, self.vmax, self.w, self.h = list(reversed(series)), max(1, vmax), width, height
    def wrap(self, *a):
        return self.w, self.h
    def draw(self):
        c = self.canv; n = len(self.s) or 1; bw = self.w / n
        for i, x in enumerate(self.s):
            if not x:
                c.setFillColor(LINE); c.rect(i * bw + 1, 0, bw - 2, 1.2, stroke=0, fill=1); continue
            h = max(1.5, self.h * min(1, x['medals'] / self.vmax))
            c.setFillColor(GOLD if x['decks'] >= 16 else colors.HexColor('#C9A04B')); c.rect(i * bw + 1, 0, bw - 2, h, stroke=0, fill=1)
            if x['decks'] < 16:  # se dejó mazos esa semana: marca roja abajo
                c.setFillColor(RED); c.rect(i * bw + 1, 0, bw - 2, 1.6, stroke=0, fill=1)


class WeekChart(Flowable):
    """Barras de medallas por semana con la media del clan (línea discontinua)."""
    def __init__(self, series, clan_avg, labels, width, height=170):
        super().__init__()
        self.s, self.avg, self.lab = list(reversed(series)), list(reversed(clan_avg)), list(reversed(labels))
        self.w, self.h = width, height
    def wrap(self, *a):
        return self.w, self.h
    def draw(self):
        c = self.canv; left, bottom, top = 34, 30, 12
        ph = self.h - bottom - top; pw = self.w - left - 6
        vals = [x['medals'] for x in self.s if x] + [v for v in self.avg if v]
        vmax = max(vals + [1]) * 1.12
        step = 500 if vmax <= 4000 else 1000
        c.setFont('Body', 6.8)
        v = 0
        while v <= vmax:
            y = bottom + ph * v / vmax
            c.setStrokeColor(LINE); c.setLineWidth(0.4); c.line(left, y, left + pw, y)
            c.setFillColor(MUTED); c.drawRightString(left - 4, y - 2.2, fmt(v)); v += step
        n = len(self.s) or 1; slot = pw / n; bw = slot * 0.56
        pts = []
        for i, x in enumerate(self.s):
            cx = left + slot * (i + 0.5)
            if x:
                h = ph * x['medals'] / vmax
                c.setFillColor(GOLD if x['decks'] >= 16 else colors.HexColor('#C9A04B'))
                c.roundRect(cx - bw / 2, bottom, bw, max(1.5, h), 2, stroke=0, fill=1)
                c.setFillColor(INK); c.setFont('BodyB', 6.8); c.drawCentredString(cx, bottom + h + 3, fmt(x['medals']))
                if x['decks'] < 16:
                    c.setFillColor(RED); c.setFont('Body', 6.2); c.drawCentredString(cx, bottom + h + 11, f"{x['decks']}/16")
            else:
                c.setFillColor(MUTED); c.setFont('Body', 6.4); c.drawCentredString(cx, bottom + 3, 'no estaba')
            if self.avg[i]:
                pts.append((cx, bottom + ph * self.avg[i] / vmax))
            c.setFillColor(MUTED); c.setFont('Body', 6.2)
            lab = self.lab[i].replace(' (coliseo)', '*')
            c.drawCentredString(cx, bottom - 11, lab)
        if len(pts) > 1:
            c.setStrokeColor(colors.HexColor('#5B6F7A')); c.setLineWidth(1.1); c.setDash(3, 2)
            p = c.beginPath(); p.moveTo(*pts[0])
            for q in pts[1:]: p.lineTo(*q)
            c.drawPath(p, stroke=1, fill=0); c.setDash()


def hexc(col):
    return '#' + col.hexval()[2:]


def badge(text, color):
    st = B.ParagraphStyle('bd', parent=S['cellb'], textColor=color, alignment=1)
    return Paragraph(esc(text), st)


def page_setup(out, title, subtitle, line2, when, clan):
    def on_page(c, doc):
        c.saveState()
        if doc.page == 1:
            c.setFillColor(INK); c.rect(0, H - 118, W, 118, stroke=0, fill=1)
            c.setFillColor(GOLD); c.rect(0, H - 121, W, 3, stroke=0, fill=1)
            c.setFillColor(colors.white); c.setFont('Head', 26); c.drawString(36, H - 60, title[:38])
            c.setFont('HeadM', 11); c.setFillColor(colors.HexColor('#F3D27A')); c.drawString(36, H - 82, subtitle)
            c.setFont('Body', 9); c.setFillColor(colors.HexColor('#C9D6CF')); c.drawString(36, H - 100, line2)
        c.setFont('Body', 7.4); c.setFillColor(MUTED)
        c.drawString(36, 22, f"{clan['name']} {clan['tag']}  |  Datos de la API oficial de Clash Royale  |  {when:%d/%m/%Y %H:%M}")
        c.drawRightString(W - 36, 22, f'Página {doc.page}')
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(36, 32, W - 36, 32)
        c.restoreState()
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=40, bottomMargin=46,
                          title=f'{title}: {subtitle}', author=clan['name'])
    doc.addPageTemplates([PageTemplate(id='First', frames=[Frame(36, 46, CW, H - 46 - 136)], onPage=on_page),
                          PageTemplate(id='Later', frames=[Frame(36, 46, CW, H - 46 - 40)], onPage=on_page)])
    return doc


def kick_note(k, opts):
    c = opts['coef']
    return (f"Nota = media de sus días (0 mazos {dec(c[0], 2)}, 1: {dec(c[1], 2)}, 2: {dec(c[2], 2)}, 3: {dec(c[3], 2)}, los 4: {dec(c[4], 2)}) "
            f"+ {dec(opts['medalWeight'], 1)} × (0,5 + (medallas por semana − {fmt(opts.get('medalTarget', 2400))}) × 0,001), "
            f"en las últimas {opts['weeksUsed']} semanas (hacen falta 4 con datos). Expulsar por debajo de {dec(opts['threshold'], 1)}; "
            f"vigilar hasta {dec(opts['threshold'] + 1, 1)}; bien por encima. Son los mismos ajustes que en la pestaña «Expulsiones» de la web.")


def build_clan(data, out):
    r = data['report']; clan = r['clan']; opts = r['kickOpts']
    when = datetime.fromisoformat(data['generatedAt'].replace('Z', '+00:00')).astimezone(ZoneInfo(data.get('tz') or 'Europe/Madrid'))
    players = r['players']
    span = f"{r['labels'][-1].replace(' (coliseo)', '')} a {r['labels'][0].replace(' (coliseo)', '')}" if r['labels'] else ''
    doc = page_setup(out, clan['name'], f'Informe de jugadores  |  Últimas {len(r["labels"])} semanas ({span})',
                     f"{clan['tag']}  |  {DAYS[when.weekday()]} {when.day} de {MONTHS[when.month - 1]} de {when.year}, {when:%H:%M}", when, clan)
    story = [NextPageTemplate('Later')]
    tot_med = sum(p['medals'] for p in players); tot_decks = sum(p['decks'] for p in players)
    exp = [p for p in players if p['kick']['verdict'] == 'expulsar']
    vig = [p for p in players if p['kick']['verdict'] == 'vigilar']
    story += [B.kpis([(str(len(players)), 'miembros en el clan'),
                      (dec(tot_med / tot_decks if tot_decks else None), 'medallas por ataque (media del clan)'),
                      (fmt(sum(p['missed'] for p in players)), 'mazos dejados en las semanas que estaban'),
                      (f"{len(exp)} · {len(vig)}", 'para expulsar · para vigilar')], CW), Spacer(1, 12)]

    # ----- Expulsiones -----
    story.append(Paragraph('Candidatos a expulsión', S['h2']))
    flagged = exp + vig
    if flagged:
        rows = [B.hdr(['Veredicto', 'Jugador', 'Nota', 'Días sin jugar', 'Días con 1-2', 'Medallas/día', 'Media/sem.', 'Tendencia'], left=2)]
        for p in flagged:
            k = p['kick']; v = VERDICT[k['verdict']]; t = TREND[p['trend']['label']]
            rows.append([badge(v[0], v[1]), Paragraph(rich(p['name']) + f' <font size="6.5" color="#5E6E66">{esc(p["role"])}</font>', S['cell']),
                         dec(k['score'], 2), str(k['counts'][0]), str(k['counts'][1] + k['counts'][2]), fmt(k['medalsPerDay']),
                         fmt(p['avgWeek']), badge(t[0], t[1])])
        t = Table(rows, colWidths=[56, 150, 40, 54, 52, 56, 50, CW - 458], repeatRows=1)
        st = B.base_style(len(rows), numeric_from=2); t.setStyle(TableStyle(st))
        story.append(t)
    else:
        story.append(Paragraph('Nadie está por debajo del umbral ni en zona de vigilancia.', S['p']))
    news = [p for p in players if p['kick']['verdict'] == 'nuevo']
    story += [Spacer(1, 4), Paragraph(kick_note(None, opts), S['note'])]
    if news:
        story += [Spacer(1, 4), Paragraph('Con pocos datos para valorar (nuevos): ' + ', '.join(rich(p['name']) for p in news) + '.', S['note'])]

    # ----- Mejoran / empeoran -----
    vmax = max([x['medals'] for p in players for x in p['series'] if x] + [1])
    def trend_table(lst, title):
        rows = [B.hdr(['Jugador', 'Antes (6 sem.)', 'Ahora (4 sem.)', 'Cambio', '10 semanas'], left=1)]
        for p in lst:
            tr = p['trend']; col = GREEN if tr['delta'] > 0 else RED
            rows.append([Paragraph(rich(p['name']), S['cell']), fmt(tr['before']), fmt(tr['recent']),
                         badge(f"{'+' if tr['delta'] > 0 else ''}{round(tr['delta'] * 100)} %", col), Spark(p['series'], vmax)])
        t = Table(rows, colWidths=[150, 70, 70, 60, CW - 350], repeatRows=1)
        st = B.base_style(len(rows)); st.append(('ALIGN', (4, 0), (4, -1), 'LEFT')); t.setStyle(TableStyle(st))
        return KeepTogether([Paragraph(title, S['h2']), t])
    up = sorted([p for p in players if p['trend']['label'] == 'mejora'], key=lambda p: -p['trend']['delta'])[:10]
    down = sorted([p for p in players if p['trend']['label'] == 'empeora'], key=lambda p: p['trend']['delta'])[:10]
    story.append(PageBreak())
    story += [Paragraph('Quién mejora y quién empeora', S['h1']),
              Paragraph('Media de medallas de sus últimas 4 semanas frente a las 6 anteriores (solo semanas en que jugó). '
                        'En la minigráfica, de la semana más antigua a la más reciente; la raya roja marca las semanas en que se dejó mazos.', S['sub'])]
    story.append(trend_table(up, f'Mejoran ({len(up)})') if up else Paragraph('Nadie mejora más de un 5 %.', S['p']))
    story.append(Spacer(1, 10))
    story.append(trend_table(down, f'Empeoran ({len(down)})') if down else Paragraph('Nadie empeora más de un 5 %.', S['p']))

    # ----- Ranking -----
    story.append(PageBreak())
    story += [Paragraph(f'Ranking de las {len(r["labels"])} semanas', S['h1']),
              Paragraph('Medallas totales de cada miembro. «Mazos»: jugados de los posibles en las semanas que estaba (16 por semana).', S['sub'])]
    rows = [B.hdr(['#', 'Jugador', 'Medallas', 'Media/sem.', 'Por ataque', 'Mazos', 'Tendencia', '10 semanas'], left=2)]
    for p in players:
        t = TREND[p['trend']['label']]
        rows.append([str(p['rank']), Paragraph(rich(p['name']) + f' <font size="6.5" color="#5E6E66">{esc(p["role"])}</font>', S['cell']),
                     fmt(p['medals']), fmt(p['avgWeek']), dec(p['perDeck']), f"{p['decks']}/{p['possible']}",
                     badge(t[0], t[1]), Spark(p['series'], vmax)])
    t = Table(rows, colWidths=[20, 150, 54, 52, 48, 50, 62, CW - 436], repeatRows=1)
    st = B.base_style(len(rows), numeric_from=2, pad=2.4)
    st += [('ALIGN', (0, 0), (0, -1), 'CENTER'), ('TEXTCOLOR', (0, 1), (0, -1), MUTED), ('ALIGN', (7, 0), (7, -1), 'LEFT')]
    for i, p in enumerate(players, 1):
        if p['rank'] in B.PODIUM: st.append(('BACKGROUND', (0, i), (0, i), B.PODIUM[p['rank']])); st.append(('TEXTCOLOR', (0, i), (0, i), INK))
        if p['missed']: st.append(('TEXTCOLOR', (5, i), (5, i), RED if p['missed'] >= 8 else AMBER))
    t.setStyle(TableStyle(st))
    story.append(t)
    doc.build(story)


# ---------- Ficha completa del jugador (perfil, mazo, mazos usados y últimas batallas) ----------
RESULT = {'win': ('Victoria', GREEN), 'loss': ('Derrota', RED), 'draw': ('Empate', MUTED)}


def card_kind(c):
    if c.get('unknown'):
        return 'Campeón (no visible)'
    if c.get('champion'):
        return 'Campeón'
    if c.get('hero'):
        return 'Héroe'
    if c.get('evo'):
        return 'Evolución'
    return c.get('rarity') or ''


def profile_story(v, tz):
    out = []
    c = v['cards']; b = v['battles']; w = v.get('war') or {}; a = w.get('activity') or {}
    pol = (v.get('pathOfLegend') or {}).get('current')
    pol_txt = f"liga {pol['league']}" + (f" · {fmt(pol['trophies'])}" if pol.get('trophies') else '') if pol and (pol.get('trophies') or (pol.get('league') or 0) > 1) else '—'
    out += [Paragraph('Perfil', S['h2']),
            B.kpis([(fmt(v.get('expLevel')), 'nivel'),
                    (fmt(v.get('trophies')), f"trofeos (máx. {fmt(v.get('bestTrophies'))})"),
                    (pol_txt, 'Path of Legend'),
                    (fmt(v.get('kingTowerLevel')), 'torre del rey'),
                    (dec(c.get('avgLevel'), 1), f"nivel medio de cartas (máx. {c.get('top')})"),
                    (f"{len(c.get('evolutions', []))} · {len(c.get('heroes', []))}", f"evoluciones (de {c.get('evoSlots')}) · héroes (de {c.get('heroSlots')})")], CW),
            Spacer(1, 6)]
    if a.get('label'):
        out.append(Paragraph(f"<b>Guerra:</b> {esc(a['label'])}" + (f" ({dec(a['avgDecks'], 1)} mazos por semana de media)" if a.get('avgDecks') is not None else '') +
                             (f" · <b>Últimas {len(b['list'])} batallas:</b> {b['wins']} victorias y {b['losses']} derrotas ({round(b['winRate'] * 100)} %)" if b.get('winRate') is not None else ''), S['p']))
    # Mazo actual
    rows = [B.hdr(['Mazo actual', 'Nivel', 'Tipo', 'Elixir'], left=1)]
    for d in c.get('deck', []):
        rows.append([Paragraph(esc(d['name']), S['cell']), fmt(d.get('level')) if d.get('level') else '—', card_kind(d), fmt(d.get('elixir')) if d.get('elixir') is not None else '—'])
    t = Table(rows, colWidths=[CW - 230, 60, 110, 60])
    st = B.base_style(len(rows), numeric_from=1)
    for i, d in enumerate(c.get('deck', []), 1):
        if d.get('champion') or d.get('hero') or d.get('evo'):
            st.append(('TEXTCOLOR', (2, i), (2, i), GOLD))
    t.setStyle(TableStyle(st))
    out += [KeepTogether([Paragraph('Mazo actual' + (f" · elixir medio {dec(c.get('deckElixir'), 1)}" if c.get('deckElixir') else ''), S['h2']), t]), Spacer(1, 8)]
    # Mazos usados en las últimas batallas
    if b.get('decks'):
        rows = [B.hdr(['Mazo', 'Partidas', 'Victorias'], left=1)]
        for d in b['decks']:
            rows.append([Paragraph(esc(', '.join(x['name'] for x in d['cards'])), S['cell']), str(d['n']), f"{d['wins']} ({round(d['wins'] / d['n'] * 100)} %)"])
        t = Table(rows, colWidths=[CW - 150, 60, 90])
        t.setStyle(TableStyle(B.base_style(len(rows), numeric_from=1)))
        out += [KeepTogether([Paragraph(f"Mazos usados en las últimas {len(b['list'])} batallas", S['h2']), t]), Spacer(1, 8)]
    # Últimas batallas
    if b.get('list'):
        rows = [B.hdr(['Fecha', 'Tipo', 'Resultado', 'Coronas', 'Rival', 'Trofeos'], left=2)]
        for x in b['list']:
            when = datetime.fromisoformat(x['time'].replace('Z', '+00:00')).astimezone(tz) if x.get('time') else None
            tc = x.get('trophyChange')
            rival = esc(x.get('opponent') or '—') + (f" <font color=\"#5E6E66\">· {esc(x['opponentClan'])}</font>" if x.get('opponentClan') else '')
            rows.append([f"{when:%d/%m %H:%M}" if when else '—', Paragraph(esc(x['label']), S['cell']), RESULT[x['result']][0],
                         f"{x['crowns']}–{x['oppCrowns']}", Paragraph(rival, S['cell']), (('+' if tc > 0 else '') + str(tc)) if tc else ''])
        t = Table(rows, colWidths=[62, 120, 58, 48, CW - 336, 48], repeatRows=1)
        st = B.base_style(len(rows), numeric_from=3)
        st += [('ALIGN', (4, 0), (4, -1), 'LEFT'), ('ALIGN', (2, 0), (2, -1), 'LEFT')]
        for i, x in enumerate(b['list'], 1):
            st.append(('TEXTCOLOR', (2, i), (2, i), RESULT[x['result']][1]))
            if x.get('trophyChange'):
                st.append(('TEXTCOLOR', (5, i), (5, i), GREEN if x['trophyChange'] > 0 else RED))
        t.setStyle(TableStyle(st))
        out += [Paragraph(f"Últimas {len(b['list'])} batallas", S['h2']), t, Spacer(1, 12)]
    return out


def build_player(data, out):
    r = data['report']; clan = r['clan']; opts = r['kickOpts']
    p = next((x for x in r['players'] if x['tag'] == data['tag']), None)
    if not p:
        raise SystemExit('jugador no encontrado en el clan')
    when = datetime.fromisoformat(data['generatedAt'].replace('Z', '+00:00')).astimezone(ZoneInfo(data.get('tz') or 'Europe/Madrid'))
    doc = page_setup(out, p['name'], f"Ficha de jugador  |  {p['role'] or 'Miembro'} de {clan['name']}",
                     f"{p['tag']}  |  Últimas {len(r['labels'])} semanas  |  {DAYS[when.weekday()]} {when.day} de {MONTHS[when.month - 1]}, {when:%H:%M}", when, clan)
    story = [NextPageTemplate('Later')]
    tr = TREND[p['trend']['label']]
    story += [B.kpis([(f"{p['rank']}º", f"del clan en medallas ({len(r['players'])} miembros)"),
                      (fmt(p['avgWeek']), 'medallas por semana'),
                      (dec(p['perDeck']), 'medallas por ataque'),
                      (pct(p['decks'] / p['possible'] if p['possible'] else None), f"de mazos jugados ({p['decks']}/{p['possible']})"),
                      (tr[0].split(' ')[0] + (f" {'+' if p['trend']['delta'] > 0 else ''}{round(p['trend']['delta'] * 100)} %" if p['trend']['delta'] is not None else ''),
                       'tendencia (4 últimas vs 6 anteriores)')], CW), Spacer(1, 14)]
    if data.get('profile'):
        story += profile_story(data['profile'], when.tzinfo)
        story.append(Paragraph('Guerra en el clan', S['h2']))
    story += [Paragraph('Medallas por semana', S['h2']), WeekChart(p['series'], r['clanAvg'], r['labels'], CW),
              Paragraph('Barras doradas: sus medallas. Línea discontinua: media del clan. En rojo, los mazos jugados cuando no fueron los 16. '
                        '* = semana de coliseo.', S['note']), Spacer(1, 10)]
    rows = [B.hdr(['Semana', 'Medallas', 'Mazos', 'Por ataque', 'Puesto en el clan', 'Media del clan', 'Diferencia'], left=1)]
    for lab, x, avg in zip(r['labels'], p['series'], r['clanAvg']):
        if not x:
            rows.append([lab, '—', '—', '—', '—', fmt(avg), '—']); continue
        diff = x['medals'] - avg if avg else None
        rows.append([lab, fmt(x['medals']), f"{x['decks']}/16", dec(x['medals'] / x['decks'] if x['decks'] else None),
                     f"{x['rank']}º" if x['rank'] else '—', fmt(avg), (('+' if diff >= 0 else '−') + fmt(abs(diff))) if diff is not None else '—'])
    t = Table(rows, colWidths=[110, 64, 50, 60, 80, 70, CW - 434], repeatRows=1)
    st = B.base_style(len(rows), numeric_from=1)
    for i, x in enumerate(p['series'], 1):
        if x and x['decks'] < 16: st.append(('TEXTCOLOR', (2, i), (2, i), RED))
        if x and r['clanAvg'][i - 1]:
            st.append(('TEXTCOLOR', (6, i), (6, i), GREEN if x['medals'] >= r['clanAvg'][i - 1] else RED))
    t.setStyle(TableStyle(st))
    story += [KeepTogether([Paragraph('Semana a semana', S['h2']), t]), Spacer(1, 12)]
    k = p['kick']; v = VERDICT[k['verdict']]
    story += [Paragraph('Situación de expulsión', S['h2']),
              Paragraph(f'<font color="{hexc(v[1])}"><b>{v[0]}</b></font> · nota {dec(k["score"], 2)} · '
                        f'{k["counts"][0]} días sin jugar, {k["counts"][1] + k["counts"][2]} con 1-2 mazos, '
                        f'{k["counts"][3]} con 3 y {k["counts"][4]} con los 4, en {k["days"]} días de guerra · '
                        f'{fmt(k["medalsPerDay"])} medallas por día.', S['p']),
              Paragraph(kick_note(k, opts), S['note'])]
    doc.build(story)


def main():
    data = json.load(sys.stdin)
    buf = io.BytesIO()
    (build_player if data.get('mode') == 'player' else build_clan)(data, buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
