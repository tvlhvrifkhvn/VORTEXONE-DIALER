// Time-zone data for calling hours (services/callingHours.js is the only user).
// A lead may sit in one of several zones when its state or area code is split;
// callingHours then only allows a dial when EVERY possible zone is inside
// 8am–9pm (the conservative rule). Zones are IANA names, so daylight saving is
// handled by Intl.
const { STATE_BY_AREA_CODE } = require('./stateFromAreaCode');

const ET = 'America/New_York';
const CT = 'America/Chicago';
const MT = 'America/Denver';
const PT = 'America/Los_Angeles';
const AZ = 'America/Phoenix'; // no DST
const AK = 'America/Anchorage';
const ADAK = 'America/Adak'; // Aleutians, one hour behind Anchorage
const HI = 'Pacific/Honolulu'; // no DST
const BOISE = 'America/Boise'; // Mountain
const INDY = 'America/Indiana/Indianapolis'; // Eastern
const DETROIT = 'America/Detroit'; // Eastern
const MENOMINEE = 'America/Menominee'; // Central (Michigan UP border counties)

// Every zone a state reaches. The first is the state's main zone; split states
// list all of theirs (unknown city → all must be open).
const STATE_ZONES = {
  AL: [CT], AK: [AK, ADAK], AZ: [AZ, MT], AR: [CT], CA: [PT], CO: [MT], CT: [ET], DE: [ET], DC: [ET],
  FL: [ET, CT], GA: [ET], HI: [HI], ID: [BOISE, PT], IL: [CT], IN: [INDY, CT], IA: [CT], KS: [CT, MT],
  KY: [ET, CT], LA: [CT], ME: [ET], MD: [ET], MA: [ET], MI: [DETROIT, MENOMINEE], MN: [CT], MS: [CT],
  MO: [CT], MT: [MT], NE: [CT, MT], NV: [PT, MT], NH: [ET], NJ: [ET], NM: [MT], NY: [ET], NC: [ET],
  ND: [CT, MT], OH: [ET], OK: [CT], OR: [PT, BOISE], PA: [ET], RI: [ET], SC: [ET], SD: [CT, MT],
  TN: [CT, ET], TX: [CT, MT], UT: [MT], VT: [ET], VA: [ET], WA: [PT], WV: [ET], WI: [CT], WY: [MT],
  // US territories
  PR: ['America/Puerto_Rico'], VI: ['America/St_Thomas'], GU: ['Pacific/Guam'],
  MP: ['Pacific/Saipan'], AS: ['Pacific/Pago_Pago'],
};

// Area codes whose zone differs from their state's main zone, or that straddle
// two zones (then both are listed). Every other known area code takes its
// state's main zone.
const AREA_CODE_ZONE_OVERRIDES = {
  // Texas: 915 = El Paso + Hudspeth (Mountain); 432 includes Culberson County (Mountain)
  915: [MT], 432: [CT, MT],
  // Florida: 850/448 = panhandle; west of the Apalachicola is Central, Tallahassee Eastern
  850: [ET, CT], 448: [ET, CT],
  // Kentucky: 270/364 are mostly Central (Bowling Green, Paducah) but reach Eastern counties; 606 reaches Central counties
  270: [CT, ET], 364: [CT, ET], 606: [ET, CT],
  // Indiana: 219 = NW Indiana (Gary — Central); 812/930 = southern Indiana (Evansville Central, most Eastern)
  219: [CT], 812: [INDY, CT], 930: [INDY, CT],
  // Tennessee: 423/865 = East TN (Eastern); 931 reaches Eastern counties; the rest Central
  423: [ET], 865: [ET], 931: [CT, ET],
  // Idaho: north is Pacific, south Mountain
  208: [BOISE, PT], 986: [BOISE, PT],
  // Oregon: 541/458 include Malheur County (Ontario — Mountain)
  541: [PT, BOISE], 458: [PT, BOISE],
  // Dakotas, Nebraska, Kansas: western parts are Mountain
  701: [CT, MT], 605: [CT, MT], 308: [CT, MT], 620: [CT, MT], 785: [CT, MT],
  // Michigan: 906 = Upper Peninsula (four border counties are Central)
  906: [DETROIT, MENOMINEE],
  // Alaska: 907 includes the Aleutians
  907: [AK, ADAK],
  // Arizona: 928 includes the Navajo Nation, which observes daylight saving
  928: [AZ, MT],
  // Nevada: 775 includes West Wendover (Mountain)
  775: [PT, MT],
  // US territories
  787: ['America/Puerto_Rico'], 939: ['America/Puerto_Rico'], 340: ['America/St_Thomas'],
  671: ['Pacific/Guam'], 670: ['Pacific/Saipan'], 684: ['Pacific/Pago_Pago'],
};
const TERRITORY_BY_AREA_CODE = { 787: 'PR', 939: 'PR', 340: 'VI', 671: 'GU', 670: 'MP', 684: 'AS' };

// Known places in split states, matched as words in the lead's address/city
// text, used when the phone's area code can't settle it.
const SPLIT_PLACES = {
  TX: [[MT, ['el paso', 'hudspeth', 'van horn', 'sierra blanca', 'culberson']], [CT, ['dallas', 'houston', 'austin', 'san antonio', 'fort worth', 'lubbock', 'amarillo', 'midland', 'odessa']]],
  FL: [[CT, ['pensacola', 'panama city', 'destin', 'fort walton beach', 'crestview', 'navarre', 'milton', 'defuniak springs', 'niceville', 'gulf breeze']], [ET, ['tallahassee', 'miami', 'orlando', 'tampa', 'jacksonville']]],
  KY: [[CT, ['bowling green', 'paducah', 'owensboro', 'hopkinsville', 'murray', 'henderson', 'madisonville']], [ET, ['louisville', 'lexington', 'frankfort', 'covington', 'richmond']]],
  IN: [[CT, ['gary', 'hammond', 'merrillville', 'valparaiso', 'evansville', 'michigan city', 'east chicago', 'crown point']], [INDY, ['indianapolis', 'fort wayne', 'south bend', 'bloomington', 'carmel', 'fishers']]],
  TN: [[ET, ['knoxville', 'chattanooga', 'johnson city', 'kingsport', 'oak ridge', 'bristol']], [CT, ['nashville', 'memphis', 'clarksville', 'murfreesboro', 'jackson', 'franklin']]],
  ID: [[PT, ["coeur d'alene", 'lewiston', 'moscow', 'sandpoint', 'post falls']], [BOISE, ['boise', 'idaho falls', 'pocatello', 'twin falls', 'nampa', 'meridian']]],
  OR: [[BOISE, ['ontario', 'nyssa', 'vale']], [PT, ['portland', 'salem', 'eugene', 'bend', 'medford']]],
  ND: [[MT, ['dickinson', 'bowman', 'beach']], [CT, ['fargo', 'bismarck', 'grand forks', 'minot']]],
  SD: [[MT, ['rapid city', 'spearfish', 'sturgis', 'belle fourche']], [CT, ['sioux falls', 'pierre', 'aberdeen', 'brookings']]],
  NE: [[MT, ['scottsbluff', 'alliance', 'sidney', 'ogallala', 'chadron', 'gering']], [CT, ['omaha', 'lincoln', 'grand island', 'kearney', 'north platte']]],
  KS: [[MT, ['goodland', 'sharon springs', 'tribune', 'syracuse']], [CT, ['wichita', 'topeka', 'kansas city', 'overland park', 'olathe']]],
  MI: [[MENOMINEE, ['iron mountain', 'menominee', 'ironwood', 'iron river']], [DETROIT, ['detroit', 'grand rapids', 'lansing', 'marquette', 'ann arbor']]],
  AZ: [[MT, ['tuba city', 'window rock', 'kayenta', 'chinle']], [AZ, ['phoenix', 'tucson', 'mesa', 'scottsdale', 'flagstaff']]],
  NV: [[MT, ['west wendover']], [PT, ['las vegas', 'reno', 'henderson', 'carson city']]],
  AK: [[ADAK, ['adak']], [AK, ['anchorage', 'fairbanks', 'juneau']]],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACE_PATTERNS = Object.fromEntries(
  Object.entries(SPLIT_PLACES).map(([state, groups]) => [
    state,
    groups.map(([zone, names]) => [zone, new RegExp(`\\b(${names.map(escapeRe).join('|')})\\b`, 'i')]),
  ])
);

/** Zones for an area code, or null when the code isn't a known US one. */
function zonesForAreaCode(areaCode) {
  if (!areaCode) return null;
  if (AREA_CODE_ZONE_OVERRIDES[areaCode]) return AREA_CODE_ZONE_OVERRIDES[areaCode];
  const state = STATE_BY_AREA_CODE[areaCode];
  return state && STATE_ZONES[state] ? [STATE_ZONES[state][0]] : null;
}

function stateForAreaCode(areaCode) {
  return STATE_BY_AREA_CODE[areaCode] || TERRITORY_BY_AREA_CODE[areaCode] || null;
}

/** The zone a known place in a split state is in, from free text (city/address), or null. */
function zonesForPlace(state, text) {
  const patterns = PLACE_PATTERNS[state];
  if (!patterns || !text) return null;
  const found = patterns.filter(([, re]) => re.test(text)).map(([zone]) => zone);
  return found.length ? [...new Set(found)] : null;
}

const ALL_ZONES = [...new Set([...Object.values(STATE_ZONES).flat(), ...Object.values(AREA_CODE_ZONE_OVERRIDES).flat()])];

module.exports = { STATE_ZONES, AREA_CODE_ZONE_OVERRIDES, SPLIT_PLACES, ALL_ZONES, zonesForAreaCode, stateForAreaCode, zonesForPlace };
