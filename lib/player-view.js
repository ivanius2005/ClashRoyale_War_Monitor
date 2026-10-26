'use strict';
// Ficha de un jugador a partir de la API oficial: perfil, últimas batallas, guerra y cartas.
//
// Niveles: la API da el nivel relativo a cada rareza (una legendaria al máximo es 8/8). El nivel del juego es
// level + (máximo de las comunes − máximo de su rareza): 8/8 → 16, 11/11 (épica) → 16, 6/11 → 11.
//
// Evoluciones y héroes: evolutionLevel es una suma de casillas (1 = evolución, 2 = héroe, 3 = las dos).
// Que una carta pueda tener evolución o héroe se sabe por sus iconos (evolutionMedium / heroMedium).

const BATTLES_SHOWN = 15;
const WAR_TYPES = new Set(['riverRacePvP', 'riverRaceDuel', 'riverRaceDuelColosseum', 'boatBattle']);
const TYPE_LABEL = {
  PvP: 'Trofeos', pathOfLegend: 'Path of Legend', riverRacePvP: 'Guerra', riverRaceDuel: 'Guerra · duelo',
  riverRaceDuelColosseum: 'Guerra · duelo (Coliseo)', boatBattle: 'Guerra · barco', clanMate: 'Amistosa del clan',
  friendly: 'Amistosa', challenge: 'Desafío', tournament: 'Torneo', casual1v1: 'Casual', casual2v2: 'Casual 2c2',
  trail: 'Evento', seasonalBattle: 'Temporada', clanWarWarDay: 'Guerra',
};
const ROLE_LABEL = { member: 'Miembro', elder: 'Veterano', coLeader: 'Colíder', leader: 'Líder' };
const RARITY_LABEL = { common: 'Común', rare: 'Especial', epic: 'Épica', legendary: 'Legendaria', champion: 'Campeón' };

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const icon = (c, kind) => (c && c.iconUrls && (c.iconUrls[kind] || c.iconUrls.medium)) || null;
const canEvo = (c) => !!(c.iconUrls && c.iconUrls.evolutionMedium);
const canHero = (c) => !!(c.iconUrls && c.iconUrls.heroMedium);
const hasEvo = (c) => canEvo(c) && ((c.evolutionLevel || 0) & 1) === 1;
const hasHero = (c) => canHero(c) && ((c.evolutionLevel || 0) & 2) === 2;

// '20261022T225837.000Z' → ISO
function crDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function battleRow(b) {
  const me = (b.team && b.team[0]) || {};
  const opp = (b.opponent && b.opponent[0]) || {};
  const crowns = num(me.crowns) || 0;
  const oppCrowns = num(opp.crowns) || 0;
  let result = crowns > oppCrowns ? 'win' : crowns < oppCrowns ? 'loss' : 'draw';
  if (b.type === 'boatBattle' && typeof b.boatBattleWon === 'boolean') result = b.boatBattleWon ? 'win' : 'loss';
  return {
    time: crDate(b.battleTime),
    type: b.type,
    label: TYPE_LABEL[b.type] || (b.gameMode && b.gameMode.name) || b.type,
    war: WAR_TYPES.has(b.type),
    result,
    crowns,
    oppCrowns,
    opponent: opp.name || null,
    opponentClan: (opp.clan && opp.clan.name) || null,
    teamClan: me.clan ? { tag: me.clan.tag, name: me.clan.name } : null,
    trophyChange: num(me.trophyChange),
    // Mazo usado: para ver de un vistazo qué juega
    deck: (me.cards || []).map((c) => ({ name: c.name, icon: hasHero(c) ? icon(c, 'heroMedium') : hasEvo(c) ? icon(c, 'evolutionMedium') : icon(c, 'medium') })),
  };
}

function battles(log) {
  const all = Array.isArray(log) ? log.map(battleRow) : [];
  const shown = all.slice(0, BATTLES_SHOWN);
  const count = (rows, r) => rows.filter((x) => x.result === r).length;
  const wins = count(shown, 'win');
  const byType = [];
  for (const b of shown) {
    let t = byType.find((x) => x.label === b.label);
    if (!t) byType.push((t = { label: b.label, n: 0, wins: 0 }));
    t.n += 1;
    if (b.result === 'win') t.wins += 1;
  }
  const war = all.filter((b) => b.war);
  // Mazos usados en esas batallas (en un duelo, cada uno de sus mazos de 8 cartas cuenta aparte)
  const decks = new Map();
  for (const b of shown) {
    for (let i = 0; i + 8 <= b.deck.length; i += 8) {
      const chunk = b.deck.slice(i, i + 8);
      const key = chunk.map((c) => c.name).sort().join('|');
      const d = decks.get(key) || { cards: chunk, n: 0, wins: 0 };
      d.n += 1;
      if (b.result === 'win') d.wins += 1;
      decks.set(key, d);
    }
  }
  return {
    decks: [...decks.values()].sort((a, b) => b.n - a.n || b.wins - a.wins).slice(0, 4),
    available: all.length,
    list: shown,
    wins,
    losses: count(shown, 'loss'),
    draws: count(shown, 'draw'),
    winRate: shown.length ? wins / shown.length : null,
    byType,
    // En todo el registro (hasta ~30 batallas): cuántas son de guerra y la última
    warInLog: war.length,
    // Clanes con los que jugó guerra en su registro (para buscar su historial aunque haya cambiado de clan)
    warClans: [...new Map(war.filter((b) => b.teamClan).map((b) => [b.teamClan.tag, b.teamClan])).values()],
    lastWar: war.length ? war[0].time : null,
  };
}

// Participación en la guerra de su clan actual: esta semana y las últimas (máx. 10)
function war(profile, race, riverlog) {
  const clanTag = profile.clan && profile.clan.tag;
  const out = { inClan: !!clanTag, thisWeek: null, weeks: [], activity: null };
  if (!clanTag) {
    out.activity = { level: 'sin-clan', label: 'No está en ningún clan', avgDecks: null, weeksPlayed: 0, weeksSeen: 0 };
    return out;
  }
  if (race && race.clan && race.clan.tag === clanTag) {
    const me = (race.clan.participants || []).find((p) => p.tag === profile.tag);
    if (me) out.thisWeek = { decksUsed: num(me.decksUsed) || 0, decksUsedToday: num(me.decksUsedToday) || 0, fame: num(me.fame) || 0 };
  }
  const items = (riverlog && Array.isArray(riverlog.items) ? riverlog.items : []).slice(0, 10);
  for (const w of items) {
    const st = (w.standings || []).find((s) => s.clan && s.clan.tag === clanTag);
    const me = st && (st.clan.participants || []).find((p) => p.tag === profile.tag);
    out.weeks.push({
      label: `T${w.seasonId}·S${(w.sectionIndex || 0) + 1}`,
      present: !!me,
      decksUsed: me ? num(me.decksUsed) || 0 : null,
      fame: me ? num(me.fame) || 0 : null,
    });
  }
  const seen = out.weeks.filter((w) => w.present);
  const avg = seen.length ? seen.reduce((s, w) => s + w.decksUsed, 0) / seen.length : null;
  const played = seen.filter((w) => w.decksUsed > 0).length;
  let level; let label;
  if (!seen.length) {
    level = 'nuevo';
    label = out.thisWeek && out.thisWeek.decksUsed ? `Nuevo en el clan: esta semana lleva ${out.thisWeek.decksUsed} mazos` : 'Aún no aparece en el historial de guerra de su clan';
  } else if (avg >= 14) { level = 'muy-activo'; label = 'Muy activo en guerra'; }
  else if (avg >= 9) { level = 'activo'; label = 'Activo en guerra'; }
  else if (avg > 0) { level = 'poco'; label = 'Juega poco la guerra'; }
  else { level = 'no'; label = 'No juega la guerra'; }
  out.activity = { level, label, avgDecks: avg, weeksPlayed: played, weeksSeen: seen.length, avgFame: seen.length ? seen.reduce((s, w) => s + w.fame, 0) / seen.length : null };
  return out;
}

// La API da el mazo actual sin el campeón (7 cartas). Se completa con la partida más reciente que tenga esas 7:
// la carta que sobra es la que falta (normalmente el campeón). En los duelos, cada mazo son 8 cartas seguidas.
function completeDeck(profile, log) {
  const deck = Array.isArray(profile.currentDeck) ? profile.currentDeck : [];
  if (deck.length >= 8 || !deck.length) return { cards: deck, missing: 0, from: null };
  const ids = new Set(deck.map((c) => c.id));
  for (const b of Array.isArray(log) ? log : []) {
    const all = (b.team && b.team[0] && b.team[0].cards) || [];
    for (let i = 0; i + 8 <= all.length; i += 8) {
      const chunk = all.slice(i, i + 8);
      if (deck.every((c) => chunk.some((x) => x.id === c.id))) {
        const extra = chunk.filter((x) => !ids.has(x.id));
        if (extra.length === 8 - deck.length) return { cards: deck.concat(extra.map((x) => Object.assign({ fromBattle: true }, x))), missing: 0, from: b.battleTime };
      }
    }
  }
  return { cards: deck, missing: 8 - deck.length, from: null };
}

function cards(profile, log) {
  const list = Array.isArray(profile.cards) ? profile.cards : [];
  const support = Array.isArray(profile.supportCards) ? profile.supportCards : [];
  const top = Math.max(0, ...list.map((c) => num(c.maxLevel) || 0), ...support.map((c) => num(c.maxLevel) || 0));
  const lvl = (c) => (num(c.level) || 0) + top - (num(c.maxLevel) || top);
  const byLevel = {};
  for (const c of list) byLevel[lvl(c)] = (byLevel[lvl(c)] || 0) + 1;
  const full = completeDeck(profile, log);
  const deckIn = new Set(full.cards.map((c) => c.id));
  const evo = list.filter(hasEvo).map((c) => ({ name: c.name, icon: icon(c, 'evolutionMedium'), level: lvl(c), inDeck: deckIn.has(c.id) }));
  const hero = list.filter(hasHero).map((c) => ({ name: c.name, icon: icon(c, 'heroMedium'), level: lvl(c), inDeck: deckIn.has(c.id) }));
  // El nivel de las cartas sacadas de una batalla se toma de la colección (la batalla puede ser de otro modo)
  const owned = new Map(list.map((c) => [c.id, c]));
  const deck = full.cards.map((c0) => {
    const c = Object.assign({}, owned.get(c0.id) || c0, { fromBattle: !!c0.fromBattle });
    return {
      name: c.name, level: lvl(c), rarity: RARITY_LABEL[c.rarity] || c.rarity, elixir: num(c.elixirCost),
      evo: hasEvo(c), hero: hasHero(c), champion: c.rarity === 'champion', fromBattle: c.fromBattle, icon: icon(c, 'medium'),
    };
  });
  for (let i = 0; i < full.missing; i++) deck.push({ name: 'Campeón', unknown: true, champion: true, level: null, icon: null });
  const champions = list.filter((c) => c.rarity === 'champion').map((c) => ({ name: c.name, icon: icon(c, 'medium'), level: lvl(c), inDeck: deckIn.has(c.id) }));
  const elix = deck.map((c) => c.elixir).filter((x) => x != null);
  const towerInUse = new Set((profile.currentDeckSupportCards || []).map((c) => c.id));
  return {
    total: list.length,
    top,
    avgLevel: list.length ? list.reduce((s, c) => s + lvl(c), 0) / list.length : null,
    maxed: list.filter((c) => lvl(c) >= top).length,
    byLevel: Object.keys(byLevel).map(Number).sort((a, b) => b - a).map((l) => ({ level: l, n: byLevel[l] })),
    evolutions: evo,
    evoSlots: list.filter(canEvo).length,
    heroes: hero,
    heroSlots: list.filter(canHero).length,
    deck,
    deckFrom: full.from ? crDate(full.from) : null,
    champions,
    deckElixir: elix.length ? elix.reduce((s, x) => s + x, 0) / elix.length : null,
    tower: support.map((c) => ({ name: c.name, level: lvl(c), inUse: towerInUse.has(c.id), icon: icon(c, 'medium') })),
    favourite: (profile.currentFavouriteCard && profile.currentFavouriteCard.name) || null,
  };
}

function polResult(r) {
  return r && (r.leagueNumber != null || r.trophies != null) ? { league: num(r.leagueNumber), trophies: num(r.trophies), rank: num(r.rank) } : null;
}

function build(profile, log, race, riverlog, meta = {}) {
  const p = profile || {};
  return {
    fetchedAt: meta.fetchedAt || new Date().toISOString(),
    tag: p.tag,
    name: p.name,
    expLevel: num(p.expLevel),
    kingTowerLevel: num(p.kingTowerLevel),
    trophies: num(p.trophies),
    bestTrophies: num(p.bestTrophies),
    arena: (p.arena && p.arena.name) || null,
    pathOfLegend: { current: polResult(p.currentPathOfLegendSeasonResult), best: polResult(p.bestPathOfLegendSeasonResult) },
    totals: {
      wins: num(p.wins), losses: num(p.losses), battles: num(p.battleCount), threeCrowns: num(p.threeCrownWins),
      warDayWins: num(p.warDayWins), clanCards: num(p.clanCardsCollected), donations: num(p.donations), totalDonations: num(p.totalDonations),
    },
    clan: p.clan ? { tag: p.clan.tag, name: p.clan.name, role: ROLE_LABEL[p.role] || p.role || null } : null,
    battles: battles(log),
    war: war(p, race, riverlog),
    cards: cards(p, log),
  };
}

module.exports = { build, BATTLES_SHOWN, TYPE_LABEL };
