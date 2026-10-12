"use strict";
var Lemma = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lemma.ts
  var lemma_exports = {};
  __export(lemma_exports, {
    baseForms: () => baseForms,
    lookup: () => lookup
  });
  var IRREGULAR = {
    am: "be",
    is: "be",
    are: "be",
    was: "be",
    were: "be",
    been: "be",
    being: "be",
    has: "have",
    had: "have",
    having: "have",
    does: "do",
    did: "do",
    done: "do",
    went: "go",
    gone: "go",
    goes: "go",
    made: "make",
    said: "say",
    got: "get",
    gotten: "get",
    took: "take",
    taken: "take",
    came: "come",
    saw: "see",
    seen: "see",
    knew: "know",
    known: "know",
    thought: "think",
    told: "tell",
    found: "find",
    gave: "give",
    given: "give",
    left: "leave",
    felt: "feel",
    brought: "bring",
    began: "begin",
    begun: "begin",
    kept: "keep",
    held: "hold",
    wrote: "write",
    written: "write",
    stood: "stand",
    heard: "hear",
    meant: "mean",
    met: "meet",
    paid: "pay",
    sat: "sit",
    spoke: "speak",
    spoken: "speak",
    led: "lead",
    grew: "grow",
    grown: "grow",
    lost: "lose",
    fell: "fall",
    fallen: "fall",
    sent: "send",
    built: "build",
    understood: "understand",
    drew: "draw",
    drawn: "draw",
    broke: "break",
    broken: "break",
    spent: "spend",
    rose: "rise",
    risen: "rise",
    drove: "drive",
    driven: "drive",
    bought: "buy",
    wore: "wear",
    worn: "wear",
    chose: "choose",
    chosen: "choose",
    sought: "seek",
    threw: "throw",
    thrown: "throw",
    caught: "catch",
    dealt: "deal",
    won: "win",
    forgot: "forget",
    forgotten: "forget",
    sold: "sell",
    fought: "fight",
    taught: "teach",
    ate: "eat",
    eaten: "eat",
    slept: "sleep",
    hid: "hide",
    hidden: "hide",
    ran: "run",
    shown: "show",
    flew: "fly",
    flown: "fly",
    drank: "drink",
    drunk: "drink",
    sang: "sing",
    sung: "sing",
    swam: "swim",
    swum: "swim",
    rode: "ride",
    ridden: "ride",
    woke: "wake",
    woken: "wake",
    froze: "freeze",
    frozen: "freeze",
    stole: "steal",
    stolen: "steal",
    shook: "shake",
    shaken: "shake",
    bit: "bite",
    bitten: "bite",
    fed: "feed",
    fled: "flee",
    lent: "lend",
    lit: "light",
    bent: "bend",
    bound: "bind",
    bred: "breed",
    clung: "cling",
    crept: "creep",
    dug: "dig",
    hung: "hang",
    laid: "lay",
    lain: "lie",
    meant_: "mean",
    sped: "speed",
    spun: "spin",
    stuck: "stick",
    struck: "strike",
    swept: "sweep",
    swung: "swing",
    wept: "weep",
    wound: "wind",
    better: "good",
    best: "good",
    worse: "bad",
    worst: "bad",
    more: "much",
    most: "much",
    less: "little",
    least: "little",
    further: "far",
    farther: "far",
    children: "child",
    men: "man",
    women: "woman",
    people: "person",
    mice: "mouse",
    feet: "foot",
    teeth: "tooth",
    geese: "goose",
    indices: "index",
    matrices: "matrix",
    analyses: "analysis",
    criteria: "criterion",
    phenomena: "phenomenon",
    lives: "life",
    knives: "knife",
    wives: "wife",
    leaves: "leaf",
    halves: "half",
    selves: "self",
    shelves: "shelf",
    wolves: "wolf",
    thieves: "thief",
    its: "it",
    i: "I"
  };
  var VOWEL = /[aeiou]/;
  function undouble(stem) {
    const n = stem.length;
    if (n >= 3 && stem[n - 1] === stem[n - 2] && !VOWEL.test(stem[n - 1] ?? "") && !/[ls]/.test(stem[n - 1] ?? "")) {
      return stem.slice(0, -1);
    }
    return void 0;
  }
  function baseForms(raw) {
    const word = raw.toLowerCase().replace(/['’]s$/, "").replace(/['’]$/, "");
    const out = [word];
    const add = (w) => {
      if (w && w.length >= 2 && !out.includes(w)) out.push(w);
    };
    add(IRREGULAR[word]);
    if (word.endsWith("ies") && word.length > 4) add(word.slice(0, -3) + "y");
    if (word.endsWith("ied") && word.length > 4) add(word.slice(0, -3) + "y");
    if (word.endsWith("ying")) add(word.slice(0, -4) + "ie");
    if (word.endsWith("ier")) add(word.slice(0, -3) + "y");
    if (word.endsWith("iest")) add(word.slice(0, -4) + "y");
    for (const suffix of ["ing", "ed", "er", "est"]) {
      if (!word.endsWith(suffix) || word.length - suffix.length < 2) continue;
      const stem = word.slice(0, -suffix.length);
      add(undouble(stem));
      add(stem);
      add(stem + "e");
    }
    if (word.endsWith("es") && word.length > 3) {
      add(word.slice(0, -2));
      add(word.slice(0, -1));
    } else if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
      add(word.slice(0, -1));
    }
    if (word.endsWith("ly") && word.length > 4) {
      add(word.slice(0, -2));
      if (word.endsWith("ily")) add(word.slice(0, -3) + "y");
    }
    return out;
  }
  function lookup(dict, word) {
    const forms = baseForms(word);
    const own = forms[0] ?? word.toLowerCase();
    const ownSenses = dict[own];
    const base = forms.slice(1).find((f) => (dict[f]?.length ?? 0) > 0);
    const entries = [];
    if (ownSenses?.length) entries.push({ form: own, senses: ownSenses });
    if (base) {
      const baseEntry = { form: base, senses: dict[base] ?? [] };
      const verbForm = IRREGULAR[own] === base || /(ing|ed)$/.test(own);
      if (verbForm) entries.unshift(baseEntry);
      else entries.push(baseEntry);
    }
    if (entries.length === 0) return void 0;
    return { word, base: entries[0]?.form ?? own, entries: entries.slice(0, 2) };
  }
  return __toCommonJS(lemma_exports);
})();
