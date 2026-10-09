// Działy sklepu i słownik do zgadywania, gdzie co leży.
//
// Jak to działa (od najważniejszego):
//   1. pamięć rodziny — jeśli ktoś kiedyś przeniósł "hummus" do nabiału, to "hummus" zawsze tam trafia
//   2. zwroty — całe zbitki, które inaczej wpadłyby źle ("proszek do pieczenia", "masło orzechowe")
//   3. słowa — idziemy po kolei przez wyrazy nazwy; pierwszy rozpoznany decyduje
//      (w polskiej nazwie główne słowo jest zwykle pierwsze: "sok pomarańczowy", "pierogi z truskawkami").
//      Rdzeń pasuje do początku wyrazu: "jaj" łapie jaja, jajka, jajko. Przy kilku pasujących wygrywa najdłuższy.
//      Rdzeń zakończony "$" musi być całym wyrazem ("wino$" nie złapie winogron).
//   4. nic nie pasuje → "Inne"

const CATEGORIES = [
  {
    id: 'warzywa', label: 'Warzywa i owoce',
    words: [
      'warzyw', 'owoc', 'jabł', 'jabk', 'banan', 'pomidor', 'ogór', 'ogork', 'ziemniak', 'ziemniacz', 'kartofl', 'marchew', 'marchw', 'marchewk',
      'cebul', 'czosn', 'sałat', 'salat', 'papryk', 'cytryn', 'pomarańcz', 'pomarancz', 'truskaw', 'malin', 'borówk', 'borowk', 'jagod', 'jagód',
      'kapust', 'brokuł', 'brokul', 'kalafior', 'pietruszk', 'koper', 'koperek', 'szczypior', 'grusz', 'winogr', 'awokado', 'pieczark', 'grzyb',
      'boczniak', 'kurk', 'rzodkiew', 'rzodkiewk', 'burak', 'buraczk', 'seler', 'por$', 'pory$', 'cukini', 'cukinia', 'dyni', 'dynia', 'śliwk', 'sliwk',
      'kiwi', 'mandaryn', 'arbuz', 'melon', 'rukol', 'roszpunk', 'szpinak', 'jarmuż', 'imbir', 'limonk', 'natk', 'bazyli', 'mięt', 'kolendr',
      'rozmaryn', 'tymianek', 'kiełk', 'fasolk', 'bób', 'bob$', 'groszek cukrowy', 'szparag', 'bakłażan', 'baklazan', 'oberżyn', 'kalarep',
      'brukselk', 'cieciork', 'chrzan', 'ananas', 'mango', 'granat', 'grejpfrut', 'brzoskwin', 'nektaryn', 'morel', 'wiśni', 'wisni', 'czereśn',
      'czeresn', 'porzeczk', 'agrest', 'jeżyn', 'figi$', 'daktyl', 'liczi', 'papaj', 'marakuj', 'pomelo', 'kukurydza kolba', 'młoda kapusta',
      'pomidork', 'ogóreczk', 'czosnek niedźwiedzi', 'szalotk', 'ziół', 'zioła', 'kapusta pekińska',
    ],
  },
  {
    id: 'pieczywo', label: 'Pieczywo',
    words: [
      'chleb', 'chlebek', 'bułk', 'bulk', 'bułecz', 'bagiet', 'rogal', 'rogalik', 'croissant', 'chałk', 'chalk', 'tortill', 'pieczyw', 'drożdżówk',
      'drozdzowk', 'pączk', 'paczk', 'pączek', 'grahamk', 'kajzerk', 'ciabatt', 'focacci', 'pita$', 'pity$', 'lawasz', 'wrap', 'tost', 'grzank',
      'sucharki', 'suchar', 'pumpernikiel', 'precel', 'obwarzan', 'bajgiel', 'bajgl', 'muffin', 'babk', 'strucl', 'jagodzian', 'kołacz', 'chrupkie pieczywo',
      'wafle ryżowe', 'bułka tarta',
    ],
  },
  {
    id: 'nabial', label: 'Nabiał i jajka',
    words: [
      'mlek', 'mleko', 'mleczk', 'ser$', 'sera$', 'serek', 'serki', 'sery', 'jogurt', 'kefir', 'masło', 'masł', 'maslo', 'śmietan', 'smietan',
      'twaróg', 'twarog', 'twarożek', 'twarozek', 'jaj', 'maślank', 'maslank', 'mozzarell', 'feta', 'fety', 'parmezan', 'gouda', 'edam', 'cheddar',
      'brie', 'camembert', 'gorgonzol', 'mascarpone', 'ricott', 'halloumi', 'oscypek', 'skyr', 'margaryn', 'jogobell', 'danonk', 'monte', 'actimel',
      'zsiadł', 'ayran', 'śmietank', 'smietank', 'bita śmietana', 'deser mleczny', 'budyń w kubku', 'kremówk', 'kajmak', 'mleko zagęszczone',
      'serek wiejski', 'hochland', 'almette', 'philadelphia', 'tofu',
    ],
  },
  {
    id: 'mieso', label: 'Mięso i ryby',
    words: [
      'kurczak', 'kurczaka', 'pierś', 'piers', 'piersi', 'filet', 'mięs', 'mies', 'mielon', 'schab', 'boczek', 'boczk', 'szynk', 'kiełbas', 'kielbas',
      'kiełbask', 'parówk', 'parowk', 'wołow', 'wolow', 'wieprz', 'indyk', 'ryb', 'łosoś', 'losos', 'łososi', 'dorsz', 'tuńczyk', 'tunczyk',
      'karkówk', 'karkowk', 'udk', 'udziec', 'skrzyd', 'salami', 'pasztet', 'krewet', 'śledź', 'sledz', 'śledzi', 'polędwic', 'poledwic', 'żeberk',
      'zeberk', 'golonk', 'kabanos', 'mortadel', 'baleron', 'kaszank', 'salceson', 'wątrób', 'watrob', 'wątróbk', 'żołądk', 'serca', 'ozór',
      'łopatk', 'lopatk', 'gulasz', 'antrykot', 'stek', 'rostbef', 'kotlet', 'kaczk', 'kacz', 'gęś', 'ges$', 'królik', 'jagnię', 'cielęc', 'cielec',
      'makrel', 'pstrąg', 'pstrag', 'mintaj', 'morszczuk', 'halibut', 'sardyn', 'szprot', 'paluszki rybne', 'kalmar', 'ośmiornic', 'małż', 'mule',
      'surimi', 'paróweczk', 'szynecz', 'chorizo', 'prosciutto', 'pancett', 'wędlin', 'wedlin', 'wędzon', 'pieczeń', 'pieczen', 'mielonk', 'konserwa turystyczna',
      'nuggets', 'burger', 'skrzydełk', 'podudzi', 'tuszk', 'kotleciki',
    ],
  },
  {
    id: 'spizarnia', label: 'Spiżarnia',
    words: [
      'mąk', 'mak$', 'cukier', 'cukru', 'cukr', 'sól$', 'sol$', 'soli$', 'pieprz', 'ryż', 'ryz', 'makaron', 'spaghetti', 'penne', 'świderk', 'nitki',
      'lasagne', 'tagliatelle', 'kasz', 'kuskus', 'bulgur', 'quinoa', 'komos', 'olej', 'oliw', 'ocet', 'octu', 'przypraw', 'płatk', 'platk',
      'owsiank', 'musli', 'müsli', 'granol', 'konserw', 'koncentrat', 'passat', 'pomidory z puszki', 'pomidory krojone', 'groszek', 'kukurydz',
      'fasol', 'ciecierzyc', 'soczewic', 'dżem', 'dzem', 'konfitur', 'powidł', 'miód', 'miod', 'nutell', 'krem czekoladowy', 'kakao', 'drożdż',
      'drozdz', 'proszek do pieczenia', 'soda oczyszczona', 'budyń', 'budyn', 'kisiel', 'galaretk', 'żelatyn', 'ketchup', 'keczup', 'majonez',
      'musztard', 'sos', 'bulion', 'kostk', 'herbat', 'kaw', 'kawy', 'orzech', 'orzesz', 'migdał', 'migdal', 'rodzynk', 'żurawin', 'suszon',
      'bakali', 'słonecznik', 'slonecznik', 'pestk', 'siemię', 'chia', 'sezam', 'wiórki', 'wiork', 'cynamon', 'wanili', 'papryka słodka',
      'papryka ostra', 'oregano', 'bazylia suszona', 'curry', 'kurkum', 'kmin', 'majeranek', 'liść laurow', 'liscie laurow', 'ziele angielskie',
      'gałka', 'chili', 'vegeta', 'maggi', 'knorr', 'zup', 'żur', 'zur$', 'barszcz', 'chrzan w słoiku', 'ogórki kiszone', 'ogórki konserwowe',
      'kapusta kiszona', 'oliwk', 'kapar', 'pesto', 'tahini', 'hummus', 'masło orzechowe', 'mleko kokosowe', 'mleczko kokosowe', 'sos sojowy',
      'syrop', 'erytrytol', 'ksylitol', 'stewi', 'skrobi', 'mąka ziemniaczana', 'bułka tarta', 'panierk', 'chipsy bananowe', 'krem do',
      'sos pomidorowy', 'pulpa', 'puszk', 'tuńczyk w puszce', 'sardynki w', 'paprykarz', 'pasztet w puszce', 'fasolka po bretońsku', 'gołąbki w',
      'pieczarki marynowane', 'marynowan', 'słoik', 'sloik', 'cappuccino', 'kawa', 'espresso', 'yerba', 'melisa', 'mięta suszona', 'rumianek',
      'czekolada do picia', 'ciasto w proszku', 'mieszanka', 'skórka pomarańczowa', 'aromat', 'barwnik', 'cukier puder', 'cukier waniliowy',
      'polewa', 'posypk', 'opłatk', 'kluski', 'kluseczk', 'zacierk', 'łazank', 'gnocchi',
    ],
  },
  {
    id: 'mrozonki', label: 'Mrożonki',
    words: [
      'mrożon', 'mrozon', 'lody', 'lodów', 'lodow', 'loda$', 'pierog', 'pierożk', 'pierozk', 'pizz', 'frytk', 'uszk', 'kopytk', 'knedl', 'kluski śląskie',
      'pyzy', 'naleśniki mrożone', 'krokiet', 'mieszanka warzywna', 'warzywa na patelnię', 'warzywa na patelnie', 'szpinak mrożony', 'lód$', 'lod$',
      'kostki lodu', 'sorbet', 'zapiekank', 'pielmieni', 'gyoza', 'paluszki rybne mrożone', 'ciasto francuskie', 'ciasto filo', 'ciasto na pizzę',
      'magnum', 'algida', 'koral', 'zielona budka', 'rożek', 'rozek', 'świderki lodowe',
    ],
  },
  {
    id: 'napoje', label: 'Napoje',
    words: [
      'wod', 'woda', 'wody', 'sok', 'soczek', 'nektar', 'cola', 'coca', 'pepsi', 'fanta', 'sprite', '7up', 'mirinda', 'piw', 'wino$', 'wina$',
      'wino czerwone', 'wino białe', 'prosecco', 'szampan', 'wódk', 'wodk', 'whisk', 'rum$', 'gin$', 'nalewk', 'likier', 'napój', 'napoj',
      'lemoniad', 'oranżad', 'oranzad', 'kompot', 'izoton', 'energet', 'red bull', 'tiger', 'monster', 'oshee', 'kubuś', 'kubus', 'tymbark',
      'herbata mrożona', 'ice tea', 'lipton', 'nestea', 'tonic', 'kwas chlebowy', 'smoothie', 'koktajl', 'mleko roślinne', 'napój owsiany',
      'napój sojowy', 'napój migdałowy', 'mineralna', 'gazowan', 'niegazowan', 'cisowianka', 'żywiec zdrój', 'muszynianka', 'staropolanka',
      'kropla beskidu', 'nałęczowianka', 'radler', 'cydr', 'syrop do', 'kombucha',
    ],
  },
  {
    id: 'slodycze', label: 'Słodycze i przekąski',
    words: [
      'czekolad', 'ciastk', 'ciast', 'ciasteczk', 'baton', 'chips', 'czips', 'żelk', 'zelk', 'cukierk', 'paluszk', 'krakers', 'wafl', 'wafel',
      'wafelk', 'herbatnik', 'popcorn', 'draż', 'drazet', 'prince polo', 'princessa', 'delicj', 'pralin', 'bombonier', 'lizak', 'guma do żucia',
      'gum$', 'orbit', 'mentos', 'tic tac', 'haribo', 'snickers', 'mars$', 'twix', 'bounty', 'kitkat', 'kit kat', 'milka', 'wedel', 'kinder',
      'raffaello', 'ferrero', 'michałk', 'krówk', 'krowk', 'chałw', 'chalw', 'sezamk', 'piernik', 'pierniczk', 'biszkopt', 'babeczk', 'rogaliki 7',
      '7days', 'lay', 'lays', 'pringles', 'crunchips', 'chrupk', 'prażynk', 'prazynk', 'nachos', 'orzeszki ziemne', 'solone orzeszki', 'pistacj',
      'nerkowc', 'mieszanka studencka', 'batonik', 'tort', 'sernik', 'szarlotk', 'makowiec', 'pączki', 'donut', 'brownie', 'beza', 'bezy',
      'kremówki', 'eklerk', 'tiramisu', 'cukierki', 'marcepan', 'trufl', 'oreo', 'pieguski', 'jeżyki', 'jezyki', 'grzesiek', 'kopiec kreta',
    ],
  },
  {
    id: 'chemia', label: 'Chemia i dom',
    words: [
      'papier', 'ręcznik', 'recznik', 'płyn', 'plyn', 'proszek', 'kapsułk', 'kapsulk', 'mydł', 'mydl', 'mydełk', 'szampon', 'odżywk', 'odzywk',
      'pasta do', 'past do zęb', 'szczoteczk', 'szczotk', 'gąbk', 'gabk', 'zmywak', 'ściereczk', 'scierk', 'ścierk', 'worki', 'worek', 'woreczk',
      'folia', 'folii', 'chusteczk', 'tabletki do', 'odplamiacz', 'domestos', 'cif$', 'ajax', 'vanish', 'persil', 'ariel', 'lenor', 'perwoll',
      'fairy', 'ludwik', 'finish', 'somat', 'zmywark', 'żel pod', 'zel pod', 'żel do', 'zel do', 'dezodorant', 'antyperspirant', 'pieluch',
      'pampers', 'chusteczki nawilżane', 'patyczk', 'wacik', 'płatki kosmetyczne', 'sól do zmywarki', 'nabłyszczacz', 'nablyszczacz', 'odkamieniacz',
      'baterie', 'bateri', 'żarówk', 'zarowk', 'świeczk', 'swieczk', 'zapałk', 'zapalk', 'zapalniczk', 'krem do rąk', 'krem do twarzy', 'balsam',
      'maszynk', 'golark', 'pianka do golenia', 'podpaski', 'tampon', 'wkładki', 'nić dentystyczn', 'płyn do płukania', 'zmiękczacz', 'wybielacz',
      'kret$', 'udrażniacz', 'odświeżacz', 'odswiezacz', 'rękawiczk', 'rekawiczk', 'mop', 'miotł', 'szufelk', 'filtr', 'serwetk', 'serwet',
      'talerzyk', 'kubeczk', 'sztućce jednorazowe', 'słomk', 'foremk', 'papier do pieczenia', 'rękaw do pieczenia', 'woreczki śniadaniowe',
      'karma', 'żwirek', 'zwirek', 'whiskas', 'pedigree', 'felix', 'sheba', 'smycz', 'krem nivea', 'nivea', 'colgate', 'blend-a-med', 'sensodyne',
      'gillette', 'always', 'tena', 'velvet', 'regina', 'foxy', 'emolium', 'plaster', 'plastr', 'bandaż', 'apap', 'ibuprom', 'witamin', 'leki',
      'lek$', 'tabletki na', 'syrop na', 'krople', 'termometr', 'kosmetyk', 'pomadk', 'tusz do rzęs', 'lakier', 'zmywacz', 'żel antybakteryjny',
      'dezynfek', 'spray', 'środek', 'srodek', 'pasta bhp', 'ściereczki', 'gąbki', 'druciak',
    ],
  },
];

const LABELS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]).concat([['inne', 'Inne']]));
const VALID = new Set(Object.keys(LABELS));

// "Mleko 2%,  ŁACIATE" → "mleko łaciate" — wspólna postać do porównywania i do pamięci rodziny
function normalize(name) {
  return String(name)
    .toLowerCase()
    .replace(/[0-9]+(?:[.,][0-9]+)?(?:\s*(?:%|kg|g|dag|l|ml|szt|op|opak)\.?(?!\p{L}))?/gu, ' ')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// wpisy wielowyrazowe to "zwroty", jednowyrazowe to rdzenie słów
const PHRASES = [];
const STEMS = [];
for (const cat of CATEGORIES) {
  for (const w of cat.words) {
    const entry = { cat: cat.id, text: w.replace(/\$$/, ''), whole: w.endsWith('$') };
    (entry.text.includes(' ') ? PHRASES : STEMS).push(entry);
  }
}
PHRASES.sort((a, b) => b.text.length - a.text.length);

function matchWord(word) {
  let best = null;
  for (const s of STEMS) {
    const hit = s.whole ? word === s.text : word.startsWith(s.text);
    if (hit && (!best || s.text.length > best.text.length)) best = s;
  }
  return best && best.cat;
}

// learned: { "hummus": "nabial", ... } — poprawki zrobione przez rodzinę
function guessCategory(name, learned = {}) {
  const n = normalize(name);
  if (!n) return 'inne';

  // 1. pamięć: dokładnie ta nazwa, albo nazwa zaczynająca się od zapamiętanej ("hummus paprykowy" ← "hummus")
  if (learned[n]) return learned[n];
  let bestKey = '';
  for (const key of Object.keys(learned)) {
    if (n.startsWith(key + ' ') && key.length > bestKey.length) bestKey = key;
  }
  if (bestKey) return learned[bestKey];

  // 2. zwroty
  const padded = ` ${n} `;
  for (const p of PHRASES) {
    if (padded.includes(` ${p.text}`)) return p.cat;
  }

  // 3. słowa po kolei
  for (const word of n.split(' ')) {
    const cat = matchWord(word);
    if (cat) return cat;
  }
  return 'inne';
}

window.Categories = { CATEGORIES, LABELS, VALID, normalize, guessCategory };
