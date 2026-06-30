// =====================================================================
// MOOUI Dashboard — Servidor (Ponte para o Shopify)
// =====================================================================
// O que este arquivo faz:
//   1. Lê a chave do Shopify do arquivo .env (em segredo)
//   2. Sobe um mini-servidor em http://localhost:8030
//   3. Quando o dashboard pede dados, ele consulta o Shopify e devolve
//   4. Serve também o arquivo dashboard.html
//
// Para rodar: abra o terminal e digite  node servidor.js
// Para parar: aperte Ctrl+C no terminal
// =====================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Carrega o arquivo .env manualmente (sem precisar instalar nada)
function carregarEnv() {
  try {
    const conteudo = fs.readFileSync('.env', 'utf-8');
    conteudo.split('\n').forEach(linha => {
      const igual = linha.indexOf('=');
      if (igual > 0 && !linha.trim().startsWith('#')) {
        const chave = linha.slice(0, igual).trim();
        const valor = linha.slice(igual + 1).trim().replace(/^["']|["']$/g, '');
        if (chave && valor) process.env[chave] = valor;
      }
    });
  } catch (e) {
    console.error('❌ Erro: arquivo .env não encontrado.');
    console.error('   Crie um arquivo .env nesta pasta com o conteúdo:');
    console.error('   SHOPIFY_STORE=mooui-br');
    console.error('   SHOPIFY_TOKEN=shpat_xxxxxxxxxxx');
    process.exit(1);
  }
}
carregarEnv();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const PORTA = 8030;

if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
  console.error('❌ Faltam variáveis no .env (SHOPIFY_STORE e SHOPIFY_TOKEN)');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Função genérica que faz a consulta ShopifyQL
// ---------------------------------------------------------------------
function consultarShopify(shopifyQuery) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      query: `{ shopifyqlQuery(query: "${shopifyQuery.replace(/"/g, '\\"')}") { tableData { columns { name displayName } rows } parseErrors } }`
    });

    const opcoes = {
      hostname: `${SHOPIFY_STORE}.myshopify.com`,
      path: '/admin/api/2026-04/graphql.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opcoes, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(JSON.stringify(json.errors)));
          if (json.data?.shopifyqlQuery?.parseErrors?.length) {
            return reject(new Error('ShopifyQL: ' + JSON.stringify(json.data.shopifyqlQuery.parseErrors)));
          }
          resolve(json.data.shopifyqlQuery.tableData);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Valida data no formato YYYY-MM-DD (proteção contra injeção)
function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---------------------------------------------------------------------
// GraphQL Admin API (para dados de pedidos / jornada de conversão)
// ---------------------------------------------------------------------
function consultarShopifyGQL(gqlQuery, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: gqlQuery, variables });
    const opcoes = {
      hostname: `${SHOPIFY_STORE}.myshopify.com`,
      path: '/admin/api/2026-04/graphql.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opcoes, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(JSON.stringify(json.errors)));
          resolve(json.data);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const GQL_JORNADA = `
  query($cursor: String, $q: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
      edges {
        node {
          createdAt
          customerJourneySummary {
            customerOrderIndex
            daysToConversion
            momentsCount { count }
            firstVisit {
              source
              sourceType
              utmParameters { medium source campaign }
            }
            lastVisit {
              source
              sourceType
              utmParameters { medium source campaign }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GQL_RECOMPRA = `
  query($cursor: String) {
    customers(first: 250, after: $cursor, query: "orders_count:>=2") {
      edges {
        node {
          orders(first: 3, sortKey: PROCESSED_AT) {
            edges {
              node {
                processedAt
                totalPriceSet { shopMoney { amount } }
                lineItems(first: 15) {
                  edges { node { title product { productType } } }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GQL_COUNT_1_PEDIDO = `
  query($cursor: String) {
    customers(first: 250, after: $cursor, query: "orders_count:1") {
      edges {
        node {
          orders(first: 1) {
            edges { node { cancelledAt } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GQL_RISCO = `
  query($cursor: String, $q: String) {
    orders(first: 250, after: $cursor, query: $q) {
      edges {
        node {
          createdAt
          customer {
            displayName
            email
            phone
            numberOfOrders
          }
          lineItems(first: 5) {
            edges { node { title } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function agregarRecompra(clientes) {
  const buckets = ['<30 dias','30–60 dias','61–90 dias','91–120 dias','121–150 dias','151–180 dias','181–210 dias','211–240 dias','241–270 dias','271–300 dias','301–330 dias','331–365 dias','365+ dias'];
  const mkDist  = () => Object.fromEntries(buckets.map(b => [b, 0]));
  const segs = { todos: mkDist(), bebe: mkDist(), ate1k: mkDist(), acima1k: mkDist() };
  const soma = { todos:0, bebe:0, ate1k:0, acima1k:0 };
  const count = { todos:0, bebe:0, ate1k:0, acima1k:0 };
  const produtos2 = {};
  const transicoes = {};
  let somaTicket1 = 0, somaTicket2 = 0, countTicket = 0;
  const buckets3 = ['<30 dias','30–60 dias','61–90 dias','91–120 dias','121–150 dias','151–180 dias','181–210 dias','211–240 dias','241–270 dias','271–300 dias','301–330 dias','331–365 dias','365+ dias'];
  const dist3 = Object.fromEntries(buckets3.map(b => [b, 0]));
  let soma3 = 0, count3 = 0;

  for (const c of clientes) {
    const pedidos = (c.orders?.edges || []).map(e => e.node)
      .filter(o => o.processedAt)
      .sort((a,b) => new Date(a.processedAt) - new Date(b.processedAt));

    if (pedidos.length < 2) continue;

    const dias = Math.round((new Date(pedidos[1].processedAt) - new Date(pedidos[0].processedAt)) / 86400000);
    if (dias < 0) continue;

    const bucket = dias < 30 ? '<30 dias' : dias <= 60 ? '30–60 dias' : dias <= 90 ? '61–90 dias' : dias <= 120 ? '91–120 dias' : dias <= 150 ? '121–150 dias' : dias <= 180 ? '151–180 dias' : dias <= 210 ? '181–210 dias' : dias <= 240 ? '211–240 dias' : dias <= 270 ? '241–270 dias' : dias <= 300 ? '271–300 dias' : dias <= 330 ? '301–330 dias' : dias <= 365 ? '331–365 dias' : '365+ dias';

    segs.todos[bucket]++; soma.todos += dias; count.todos++;

    for (const e of (pedidos[1].lineItems?.edges || [])) {
      const t = (e.node.product?.productType || e.node.title || '').trim();
      if (t) produtos2[t] = (produtos2[t] || 0) + 1;
    }

    const prod1 = (pedidos[0].lineItems?.edges?.[0]?.node?.product?.productType || pedidos[0].lineItems?.edges?.[0]?.node?.title || '').trim();
    const prod2 = (pedidos[1].lineItems?.edges?.[0]?.node?.product?.productType || pedidos[1].lineItems?.edges?.[0]?.node?.title || '').trim();
    if (prod1 && prod2 && prod1 !== prod2) {
      const key = prod1 + '|||' + prod2;
      transicoes[key] = (transicoes[key] || 0) + 1;
    }

    const t1 = parseFloat(pedidos[0].totalPriceSet?.shopMoney?.amount || 0);
    const t2 = parseFloat(pedidos[1].totalPriceSet?.shopMoney?.amount || 0);
    if (t1 > 0 && t2 > 0) { somaTicket1 += t1; somaTicket2 += t2; countTicket++; }

    if (pedidos[2]?.processedAt) {
      const dias3 = Math.round((new Date(pedidos[2].processedAt) - new Date(pedidos[1].processedAt)) / 86400000);
      if (dias3 >= 0) {
        const b3 = dias3 < 30 ? '<30 dias' : dias3 <= 60 ? '30–60 dias' : dias3 <= 90 ? '61–90 dias' : dias3 <= 120 ? '91–120 dias' : dias3 <= 150 ? '121–150 dias' : dias3 <= 180 ? '151–180 dias' : dias3 <= 210 ? '181–210 dias' : dias3 <= 240 ? '211–240 dias' : dias3 <= 270 ? '241–270 dias' : dias3 <= 300 ? '271–300 dias' : dias3 <= 330 ? '301–330 dias' : dias3 <= 365 ? '331–365 dias' : '365+ dias';
        dist3[b3]++; soma3 += dias3; count3++;
      }
    }

    const temBebe = pedidos.some(o =>
      (o.lineItems?.edges || []).some(e => {
        const t = (e.node.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return t.includes('bebe') || t.includes('berco') || t.includes('berço');
      })
    );
    if (temBebe) { segs.bebe[bucket]++; soma.bebe += dias; count.bebe++; }

    const valorPrimeiro = parseFloat(pedidos[0].totalPriceSet?.shopMoney?.amount || 0);
    if (valorPrimeiro <= 1000) {
      segs.ate1k[bucket]++; soma.ate1k += dias; count.ate1k++;
    } else {
      segs.acima1k[bucket]++; soma.acima1k += dias; count.acima1k++;
    }
  }

  const topProdutos = Object.entries(produtos2)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([titulo, count]) => ({ titulo, count }));

  const totalTransicoes = Object.values(transicoes).reduce((a,b) => a+b, 0);
  const topTransicoes = Object.entries(transicoes)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const sep = key.indexOf('|||');
      return { de: key.slice(0, sep), para: key.slice(sep + 3), count, pct: totalTransicoes > 0 ? Math.round(count / totalTransicoes * 100) : 0 };
    });

  const fmtBRL = v => 'R$ ' + v.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const mk = seg => ({ dist: segs[seg], media: count[seg] > 0 ? (soma[seg]/count[seg]).toFixed(1) : '—', total: count[seg] });
  return {
    todos: mk('todos'), bebe: mk('bebe'), ate1k: mk('ate1k'), acima1k: mk('acima1k'),
    produtos_recompra: topProdutos,
    transicoes: topTransicoes,
    ticket_medio_1: countTicket > 0 ? fmtBRL(somaTicket1/countTicket) : '—',
    ticket_medio_2: countTicket > 0 ? fmtBRL(somaTicket2/countTicket) : '—',
    ticket_variacao: countTicket > 0 ? ((somaTicket2 - somaTicket1) / somaTicket1 * 100).toFixed(1) : null,
    terceira: { dist: dist3, media: count3 > 0 ? (soma3/count3).toFixed(1) : '—', total: count3 }
  };
}

function normalizarOrigem(sourceType, source, utm) {
  const st = (sourceType || '').toUpperCase();
  const um = (utm?.medium || '').toLowerCase();
  const us = (utm?.source || '').toLowerCase();
  const s  = (source || '').toLowerCase();

  // UTM e source têm prioridade — sourceType nulo não significa "direto"
  if (us.includes('nextags') || us.includes('next tags') || us === 'whatsapp' || us.includes('whats') || s.includes('whatsapp')) return 'WhatsApp';
  if (st === 'NEWSLETTER' || st === 'TRANSACTIONAL' || um === 'email' || us === 'email' || us === 'newsletter' || us.includes('email')) return 'E-mail';
  if (s.includes('instagram') || s.includes('facebook') || s.includes('meta') ||
      us.includes('instagram') || us.includes('facebook') || us.includes('meta') ||
      st === 'SOCIAL') return 'Meta (Instagram/FB)';
  if (s.includes('google') || us.includes('google') || us === 'adwords' ||
      st === 'SEARCH' || st === 'SEO' || um === 'cpc' || um === 'ppc') return 'Google';

  // Só é Direto quando não há UTM nem source identificável
  if (!st || st === 'DIRECT' || st === 'NOT_SET') return 'Direto';
  return 'Outros';
}

function agregarConversao(pedidos) {
  const porHora = Array(24).fill(0);
  const porOrigem = {};
  const porOrigemFechamento = {};
  const DS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const distDiaSemana = { 'Dom':0,'Seg':0,'Ter':0,'Qua':0,'Qui':0,'Sex':0,'Sáb':0 };
  let novos = 0, recorrentes = 0, semJornada = 0;
  const distSessoes  = { '1':0,'2':0,'3':0,'4':0,'5':0,'6+':0 };
  const distDias     = { 'Mesmo dia':0,'1 dia':0,'2–3 dias':0,'4–7 dias':0,'8–9 dias':0,'10–20 dias':0,'21–30 dias':0,'30+ dias':0 };
  const distAquisicao = { 'Mesmo dia':0,'1 dia':0,'2–3 dias':0,'4–7 dias':0,'8–9 dias':0,'10–20 dias':0,'21–30 dias':0,'30+ dias':0 };
  let somaSessoes=0, somaDias=0, somaAcq=0, countJ=0, countAcq=0;

  for (const p of pedidos) {
    const dtBrasilia = new Date(new Date(p.createdAt).getTime() - 3 * 3600000);
    const hora = dtBrasilia.getUTCHours();
    porHora[hora]++;
    distDiaSemana[DS[dtBrasilia.getUTCDay()]]++;

    const j = p.customerJourneySummary;
    if (!j) { semJornada++; continue; }

    const isNovo = (j.customerOrderIndex || 1) === 1;
    if (isNovo) novos++; else recorrentes++;

    if (j.firstVisit) {
      const origem = normalizarOrigem(j.firstVisit.sourceType, j.firstVisit.source, j.firstVisit.utmParameters);
      porOrigem[origem] = (porOrigem[origem] || 0) + 1;
    }

    if (j.lastVisit) {
      const origemFechamento = normalizarOrigem(j.lastVisit.sourceType, j.lastVisit.source, j.lastVisit.utmParameters);
      porOrigemFechamento[origemFechamento] = (porOrigemFechamento[origemFechamento] || 0) + 1;
    }

    const ns = j.momentsCount?.count || 1;
    somaSessoes += ns; countJ++;
    distSessoes[ns >= 6 ? '6+' : String(ns)] = (distSessoes[ns >= 6 ? '6+' : String(ns)] || 0) + 1;

    const nd = j.daysToConversion || 0;
    somaDias += nd;
    distDias[nd===0?'Mesmo dia':nd===1?'1 dia':nd<=3?'2–3 dias':nd<=7?'4–7 dias':nd<=9?'8–9 dias':nd<=20?'10–20 dias':nd<=30?'21–30 dias':'30+ dias']++;

    // Distribuição específica para clientes novos (aquisição)
    if (isNovo) {
      somaAcq += nd; countAcq++;
      const ka = nd===0?'Mesmo dia':nd===1?'1 dia':nd<=3?'2–3 dias':nd<=7?'4–7 dias':nd<=9?'8–9 dias':nd<=20?'10–20 dias':nd<=30?'21–30 dias':'30+ dias';
      distAquisicao[ka]++;
    }
  }

  return {
    total: pedidos.length,
    novos, recorrentes, semJornada,
    por_hora: porHora,
    por_origem: Object.entries(porOrigem).sort((a,b)=>b[1]-a[1]).map(([origem,count])=>({ origem, count })),
    por_origem_fechamento: Object.entries(porOrigemFechamento).sort((a,b)=>b[1]-a[1]).map(([origem,count])=>({ origem, count })),
    dist_sessoes: distSessoes,
    dist_diasemana: distDiaSemana,
    dist_dias: distDias,
    dist_aquisicao: distAquisicao,
    media_sessoes: countJ   > 0 ? (somaSessoes/countJ).toFixed(1)  : '—',
    media_dias:    countJ   > 0 ? (somaDias/countJ).toFixed(1)     : '—',
    media_aquisicao: countAcq > 0 ? (somaAcq/countAcq).toFixed(1) : '—',
  };
}

// ---------------------------------------------------------------------
// Consultas dinâmicas — datas injetadas pelo chamador
// ---------------------------------------------------------------------
function consultaVendas(de, ate) {
  return `FROM sales SHOW gross_sales, discounts, net_sales, total_sales, orders, sales_reversals SINCE ${de} UNTIL ${ate}`;
}
function consultaTopProdutos(de, ate) {
  return `FROM sales SHOW net_sales, net_items_sold GROUP BY product_title SINCE ${de} UNTIL ${ate} ORDER BY net_sales DESC LIMIT 5`;
}
function consultaTopCupons(de, ate) {
  return `FROM sales SHOW net_sales, discounts, orders GROUP BY discount_name WHERE is_discounted_sale = true SINCE ${de} UNTIL ${ate} ORDER BY orders DESC LIMIT 5`;
}
function consultaVisitas(de, ate) {
  return `FROM sessions SHOW online_store_visitors, sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout WHERE landing_page_path IS NOT NULL GROUP BY landing_page_path SINCE ${de} UNTIL ${ate} ORDER BY sessions DESC LIMIT 500`;
}

// ---------------------------------------------------------------------
// Tipos MIME para servir arquivos estáticos
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

// ---------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------
const servidor = http.createServer(async (req, res) => {
  const urlBase = req.url.split('?')[0];
  const params = new URLSearchParams(req.url.split('?')[1] || '');

  // CORS para localhost
  res.setHeader('Access-Control-Allow-Origin', '*');

  console.log(`→ ${req.method} ${req.url}`);

  // ROTA: /api/dados (uma chamada só busca tudo)
  if (urlBase === '/api/dados') {
    try {
      const hojeStr = new Date().toISOString().slice(0, 10);

      // Período das visitas (default: últimos 30 dias)
      let de = params.get('de');
      let ate = params.get('ate');
      if (!dataValida(de) || !dataValida(ate)) {
        const trinta = new Date(Date.now() - 30 * 86400000);
        de = trinta.toISOString().slice(0, 10);
        ate = hojeStr;
      }

      // Período das vendas (default: hoje)
      let de_v = params.get('de_vendas');
      let ate_v = params.get('ate_vendas');
      if (!dataValida(de_v) || !dataValida(ate_v)) {
        de_v = hojeStr;
        ate_v = hojeStr;
      }

      // Calcula período de comparação (mesmo nº de dias, imediatamente antes)
      const n_dias = Math.round((new Date(ate_v) - new Date(de_v)) / 86400000) + 1;
      const ms_ate_ant = new Date(de_v).getTime() - 86400000;
      const de_ant = new Date(ms_ate_ant - (n_dias - 1) * 86400000).toISOString().slice(0, 10);
      const ate_ant = new Date(ms_ate_ant).toISOString().slice(0, 10);

      // Tolerante a falhas em consultas opcionais
      async function safe(q) {
        try { return await consultarShopify(q); }
        catch (e) { console.warn('  ⚠ Consulta opcional falhou:', e.message); return { columns: [], rows: [] }; }
      }

      const [vendas_periodo, vendas_anterior, top_produtos, top_cupons, visitas] = await Promise.all([
        consultarShopify(consultaVendas(de_v, ate_v)),
        safe(consultaVendas(de_ant, ate_ant)),
        safe(consultaTopProdutos(de_v, ate_v)),
        safe(consultaTopCupons(de_v, ate_v)),
        consultarShopify(consultaVisitas(de, ate)),
      ]);

      console.log(`  📅 Vendas ${de_v} → ${ate_v} | Visitas ${de} → ${ate}: ${visitas.rows.length} páginas`);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        atualizado_em: new Date().toISOString(),
        periodo_visitas: { de, ate },
        periodo_vendas: { de: de_v, ate: ate_v, de_anterior: de_ant, ate_anterior: ate_ant, n_dias },
        vendas_periodo,
        vendas_anterior,
        top_produtos,
        top_cupons,
        visitas,
      }));
      console.log('  ✓ Dados enviados');
    } catch (e) {
      console.error('  ✗ Erro:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/conversao — jornada de conversão por pedido
  if (urlBase === '/api/conversao') {
    try {
      let de = params.get('de');
      let ate = params.get('ate');
      if (!dataValida(de) || !dataValida(ate)) {
        de = ate = new Date().toISOString().slice(0, 10);
      }

      const q = `created_at:>='${de}' created_at:<='${ate}T23:59:59'`;
      let todos = [], cursor = null, hasMore = true;

      while (hasMore && todos.length < 2000) {
        const data = await consultarShopifyGQL(GQL_JORNADA, { cursor, q });
        const edges = data.orders?.edges || [];
        todos.push(...edges.map(e => e.node));
        hasMore = data.orders?.pageInfo?.hasNextPage || false;
        cursor  = data.orders?.pageInfo?.endCursor  || null;
      }

      console.log(`  🔄 Conversão ${de} → ${ate}: ${todos.length} pedidos`);
      const resultado = agregarConversao(todos);
      resultado.de  = de;
      resultado.ate = ate;

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(resultado));
      console.log('  ✓ Conversão enviada');
    } catch(e) {
      console.error('  ✗ Erro conversão:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/relatorios — dados mensais para a aba Relatórios
  if (urlBase === '/api/relatorios') {
    try {
      let mes = params.get('mes');
      if (!mes || !/^\d{4}-\d{2}$/.test(mes)) mes = new Date().toISOString().slice(0, 7);

      const [ano, mesNum] = mes.split('-').map(Number);
      const mesStr = String(mesNum).padStart(2, '0');
      const de_mes  = `${mes}-01`;
      const ate_mes = `${mes}-${String(new Date(ano, mesNum, 0).getDate()).padStart(2, '0')}`;

      const anoAnt  = ano - 1;
      const de_ant  = `${anoAnt}-${mesStr}-01`;
      const ate_ant = `${anoAnt}-${mesStr}-${String(new Date(anoAnt, mesNum, 0).getDate()).padStart(2, '0')}`;

      async function safeRel(q) {
        try { return await consultarShopify(q); }
        catch (e) { console.warn('  ⚠ Rel. opcional falhou:', e.message); return { columns: [], rows: [] }; }
      }

      const [
        vendas_diarias, vendas_diarias_ant,
        por_categoria, por_estado, por_cupom, por_lancamento, por_preco,
      ] = await Promise.all([
        consultarShopify(`FROM sales SHOW total_sales, orders GROUP BY day SINCE ${de_mes} UNTIL ${ate_mes} ORDER BY day ASC`),
        safeRel(`FROM sales SHOW total_sales, orders GROUP BY day SINCE ${de_ant} UNTIL ${ate_ant} ORDER BY day ASC`),
        safeRel(`FROM sales SHOW net_sales, orders GROUP BY product_type SINCE ${de_mes} UNTIL ${ate_mes} ORDER BY net_sales DESC`),
        safeRel(`FROM sales SHOW net_sales, orders GROUP BY billing_region SINCE ${de_mes} UNTIL ${ate_mes} ORDER BY net_sales DESC LIMIT 20`),
        safeRel(`FROM sales SHOW net_sales, discounts, orders GROUP BY discount_name WHERE is_discounted_sale = true SINCE ${de_mes} UNTIL ${ate_mes} ORDER BY net_sales DESC LIMIT 20`),
        safeRel(`FROM sales SHOW net_sales, orders GROUP BY product_tag SINCE ${de_mes} UNTIL ${ate_mes} ORDER BY net_sales DESC LIMIT 500`),
        safeRel(`FROM sales SHOW net_sales, orders GROUP BY is_discounted_sale SINCE ${de_mes} UNTIL ${ate_mes}`),
      ]);

      console.log(`  📋 Relatórios ${mes}: ${vendas_diarias.rows.length} dias com vendas`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ mes, de_mes, ate_mes, de_ant, ate_ant,
        vendas_diarias, vendas_diarias_ant,
        por_categoria, por_estado, por_cupom, por_lancamento, por_preco }));
      console.log('  ✓ Relatórios enviados');
    } catch (e) {
      console.error('  ✗ Erro:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/recompra — jornada de recompra (histórico completo)
  if (urlBase === '/api/recompra') {
    try {
      // Roda as duas consultas em paralelo
      async function fetchRecompra() {
        let todos = [], cursor = null, hasMore = true, paginas = 0;
        while (hasMore && paginas < 4) {
          const data = await consultarShopifyGQL(GQL_RECOMPRA, { cursor });
          todos.push(...(data.customers?.edges || []).map(e => e.node));
          hasMore = data.customers?.pageInfo?.hasNextPage || false;
          cursor  = data.customers?.pageInfo?.endCursor  || null;
          paginas++;
        }
        return { clientes: todos, truncado: hasMore };
      }

      async function fetchCount1() {
        let total = 0, cursor = null, hasMore = true, pag = 0;
        while (hasMore && pag < 8) { // ~2000 clientes com 1 pedido
          const d = await consultarShopifyGQL(GQL_COUNT_1_PEDIDO, { cursor });
          for (const e of (d.customers?.edges || [])) {
            const pedido = e.node.orders?.edges?.[0]?.node;
            if (pedido && !pedido.cancelledAt) total++;
          }
          hasMore = d.customers?.pageInfo?.hasNextPage || false;
          cursor  = d.customers?.pageInfo?.endCursor  || null;
          pag++;
        }
        return total;
      }

      const [{ clientes: todos, truncado }, total1] = await Promise.all([fetchRecompra(), fetchCount1()]);

      console.log(`  🔄 Recompra: ${todos.length} clientes, ${total1} com 1 pedido`);
      const resultado = agregarRecompra(todos);
      resultado.total_consultados = todos.length;
      resultado.truncado = truncado;
      resultado.total_1_pedido = total1;
      resultado.taxa_retorno = total1 + resultado.todos.total > 0
        ? Math.round(resultado.todos.total / (resultado.todos.total + total1) * 100)
        : 0;

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(resultado));
      console.log('  ✓ Recompra enviada');
    } catch(e) {
      console.error('  ✗ Erro recompra:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/risco — clientes com 1 pedido dentro da janela de risco
  if (urlBase === '/api/risco') {
    try {
      const hojeMs = Date.now();
      const minDias = parseInt(params.get('min') || '30');
      const maxDias = parseInt(params.get('max') || '180');
      const dateFrom = new Date(hojeMs - maxDias * 86400000).toISOString().slice(0,10);
      const dateTo   = new Date(hojeMs - minDias * 86400000).toISOString().slice(0,10);
      const q = `created_at:>='${dateFrom}' created_at:<='${dateTo}T23:59:59'`;

      let pedidos = [], cursor = null, hasMore = true, paginas = 0;
      while (hasMore && paginas < 8) {
        const data = await consultarShopifyGQL(GQL_RISCO, { cursor, q });
        const edges = data.orders?.edges || [];
        pedidos.push(...edges.map(e => e.node));
        hasMore = data.orders?.pageInfo?.hasNextPage || false;
        cursor  = data.orders?.pageInfo?.endCursor  || null;
        paginas++;
      }

      const vistos = new Set();
      const lista = [];
      for (const pedido of pedidos) {
        const c = pedido.customer;
        if (!c) continue;
        if (parseInt(c.numberOfOrders || 0) !== 1) continue;
        const key = c.email || c.phone || c.displayName;
        if (!key || vistos.has(key)) continue;
        vistos.add(key);
        const temBebe = (pedido.lineItems?.edges || []).some(e => {
          const t = (e.node.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return t.includes('bebe') || t.includes('berco') || t.includes('berço');
        });
        lista.push({
          nome: c.displayName || '',
          email: c.email || '',
          telefone: c.phone || '',
          dias: Math.round((hojeMs - new Date(pedido.createdAt).getTime()) / 86400000),
          bebe: temBebe,
        });
      }
      lista.sort((a,b) => a.dias - b.dias);

      console.log(`  🚨 Risco: ${lista.length} clientes (janela ${minDias}–${maxDias} dias)`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ total: lista.length, total_bebe: lista.filter(c=>c.bebe).length, minDias, maxDias, truncado: hasMore, lista }));
    } catch(e) {
      console.error('  ✗ Erro risco:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/checkouts — carrinhos abandonados no período
  if (urlBase === '/api/checkouts') {
    try {
      let de = params.get('de');
      let ate = params.get('ate');
      if (!dataValida(de) || !dataValida(ate)) {
        const trinta = new Date(Date.now() - 30 * 86400000);
        de = trinta.toISOString().slice(0, 10);
        ate = new Date().toISOString().slice(0, 10);
      }
      const q = `created_at:>='${de}' created_at:<='${ate}T23:59:59'`;
      const gql = `query($cursor: String, $q: String) {
        abandonedCheckouts(first: 250, after: $cursor, query: $q) {
          edges { node { totalPriceSet { shopMoney { amount } } } }
          pageInfo { hasNextPage endCursor }
        }
      }`;
      let total = 0, valorTotal = 0, cursor = null, hasMore = true;
      while (hasMore) {
        const data = await consultarShopifyGQL(gql, { cursor, q });
        const edges = data.abandonedCheckouts?.edges || [];
        for (const e of edges) {
          total++;
          valorTotal += parseFloat(e.node.totalPriceSet?.shopMoney?.amount || 0);
        }
        hasMore = data.abandonedCheckouts?.pageInfo?.hasNextPage || false;
        cursor  = data.abandonedCheckouts?.pageInfo?.endCursor  || null;
      }
      console.log(`  🛒 Carrinhos abandonados ${de}→${ate}: ${total} (R$${valorTotal.toFixed(2)})`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ total, valor: valorTotal.toFixed(2) }));
    } catch(e) {
      console.error('  ✗ Erro checkouts:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: /api/crosssell — clientes que compraram A mas não compraram B
  if (urlBase === '/api/crosssell') {
    try {
      const comprou    = (params.get('comprou')    || '').toLowerCase().trim();
      const naoComprou = (params.get('nao_comprou') || '').toLowerCase().trim();
      if (!comprou || !naoComprou) { res.statusCode=400; res.end(JSON.stringify({erro:'Parâmetros obrigatórios: comprou, nao_comprou'})); return; }

      const gql = `query($cursor: String) {
        customers(first: 250, after: $cursor, query: "orders_count:>=1") {
          edges {
            node {
              displayName email phone
              orders(first: 20, sortKey: PROCESSED_AT) {
                edges {
                  node {
                    displayFinancialStatus cancelledAt processedAt name
                    shippingAddress { phone }
                    lineItems(first: 10) {
                      edges { node { product { productType } } }
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;

      const lista = [];
      let cursor = null, hasMore = true, paginas = 0;
      while (hasMore && paginas < 8) {
        const data = await consultarShopifyGQL(gql, { cursor });
        for (const e of (data.customers?.edges || [])) {
          const c = e.node;
          const pedidosPagos = (c.orders?.edges || []).filter(o =>
            !o.node.cancelledAt && o.node.displayFinancialStatus === 'PAID'
          );
          const tipos = pedidosPagos.flatMap(o =>
            (o.node.lineItems?.edges || []).map(li => (li.node.product?.productType || '').toLowerCase().trim())
          );
          const temA = tipos.some(t => t === comprou);
          const temB = tipos.some(t => t === naoComprou);
          if (temA && !temB) {
            const ultimoPedido = pedidosPagos[pedidosPagos.length - 1];
            const telefone = c.phone ||
              pedidosPagos.map(o => o.node.shippingAddress?.phone).find(p => p) || '';
            lista.push({
              nome: c.displayName || '',
              email: c.email || '',
              telefone,
              ultimo_pedido: ultimoPedido?.node.name || '',
              ultima_compra: ultimoPedido?.node.processedAt?.slice(0,10) || '',
            });
          }
        }
        hasMore = data.customers?.pageInfo?.hasNextPage || false;
        cursor  = data.customers?.pageInfo?.endCursor  || null;
        paginas++;
      }

      lista.sort((a,b) => b.ultima_compra.localeCompare(a.ultima_compra));
      console.log(`  🎯 Cross-sell "${comprou}" → não tem "${naoComprou}": ${lista.length} clientes`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ total: lista.length, truncado: hasMore, lista }));
    } catch(e) {
      console.error('  ✗ Erro crosssell:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }

  // ROTA: / e /dashboard.html → serve o painel
  let arquivo = urlBase === '/' ? '/dashboard.html' : urlBase;
  const caminho = path.join(__dirname, arquivo);

  fs.readFile(caminho, (err, conteudo) => {
    if (err) {
      res.statusCode = 404;
      res.end('Arquivo não encontrado: ' + arquivo);
      return;
    }
    const ext = path.extname(caminho);
    res.setHeader('Content-Type', MIME[ext] || 'text/plain');
    res.end(conteudo);
  });
});

servidor.listen(PORTA, () => {
  console.log(' =====================================');
  console.log('          MOOUI Dashboard ');
  console.log(`    🌐 http://localhost:${PORTA}`);
  console.log('           Parar: Ctrl+C ');
  console.log(' =====================================');
});