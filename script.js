const EXAMPLES = {
  'missing-where': {
    query: `-- Deletes ALL rows! Missing WHERE clause
DELETE FROM employees
salary < 30000;`,
    error: `ERROR 1064 (42000): You have an error in your SQL syntax near 'salary < 30000'`
  },
  'wrong-join': {
    query: `-- Should be LEFT JOIN to include employees without departments
SELECT e.name, d.dept_name
FROM employees e
INNER JOIN departments d ON e.dept_id = d.id
WHERE d.dept_name = 'Engineering';`,
    error: `Query runs but returns fewer rows than expected — some employees are missing`
  },
  'aggregate': {
    query: `-- GROUP BY error: selecting non-aggregated column
SELECT dept_id, name, COUNT(*) as total, SUM(salary) as total_salary
FROM employees
GROUP BY dept_id;`,
    error: `ERROR 1055: 'employees.name' isn't in GROUP BY (sql_mode=only_full_group_by)`
  },
  'subquery': {
    query: `-- Correlated subquery performance issue + wrong comparison
SELECT * FROM orders
WHERE order_id IN (
  SELECT MAX(order_id)
  FROM order_items
  GROUP BY product_id
  HAVING COUNT(*) > 5
)
AND status = 'pending'
ORDER BY created_at;`,
    error: `Returns wrong results — expecting 12 rows but getting 3`
  },
  'syntax': {
    query: `-- Multiple syntax mistakes
SELCT id, name salry
FORM employees
WHER salary > 5000
AND departement = 'HR'
ORDDER BY name ASC;`,
    error: `ERROR 1064: You have an error in your SQL syntax`
  }
};

function loadExample(key) {
  const ex = EXAMPLES[key];
  if (!ex) return;
  document.getElementById('queryInput').value = ex.query;
  document.getElementById('errorInput').value = ex.error;
  document.getElementById('schemaInput').value = '';
}

function clearInput() { document.getElementById('queryInput').value = ''; }
function clearError()  { document.getElementById('errorInput').value = ''; }

let scanCount = parseInt(sessionStorage.getItem('sql_scans') || '0');
updateCounter();

function updateCounter() {
  document.getElementById('scanCounter').textContent = scanCount + ' quer' + (scanCount === 1 ? 'y' : 'ies') + ' debugged';
}

const loadingMsgs = [
  'Parsing query tokens',
  'Checking syntax rules',
  'Analysing JOIN conditions',
  'Validating GROUP BY clauses',
  'Reviewing WHERE predicates',
  'Generating corrected query',
];
let msgInterval = null;

function startLoadingCycle() {
  let i = 0;
  document.getElementById('loadingMsg').textContent = loadingMsgs[0];
  msgInterval = setInterval(() => {
    i = (i + 1) % loadingMsgs.length;
    document.getElementById('loadingMsg').textContent = loadingMsgs[i];
  }, 1800);
}

function stopLoadingCycle() {
  if (msgInterval) { clearInterval(msgInterval); msgInterval = null; }
}

async function debugQuery() {
  const query  = document.getElementById('queryInput').value.trim();
  const errMsg = document.getElementById('errorInput').value.trim();
  const schema = document.getElementById('schemaInput').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const dialect = document.getElementById('dialect').value;

  if (!query)  return showError('Please paste a SQL query to debug.');
  if (!apiKey) return showError('Please enter your Gemini API key.');

  setLoading(true);
  hideResults();

  const prompt = `You are an expert SQL database engineer and teacher. Debug the following ${dialect} SQL query.

SQL QUERY:
\`\`\`sql
${query}
\`\`\`
${errMsg ? `\nERROR MESSAGE:\n${errMsg}` : ''}
${schema ? `\nSCHEMA / CONTEXT:\n${schema}` : ''}

Respond ONLY with a valid JSON object (no markdown, no code blocks, no extra text). Use this exact format:
{
  "has_errors": true | false,
  "severity": "critical" | "warning" | "info" | "clean",
  "summary": "<one sentence: what is the main problem or status>",
  "issues": [
    {
      "type": "critical" | "warning" | "info",
      "title": "<short issue name>",
      "description": "<what is wrong and why it matters>",
      "hint": "<how to fix this specific issue>"
    }
  ],
  "fixed_query": "<the complete corrected SQL query, properly formatted with newlines as \\n>",
  "changes": [
    "<concise description of change 1>",
    "<concise description of change 2>"
  ],
  "explanation": "<2-4 sentences: explain what was wrong in plain English a student can understand, what the fix does, and any DBMS concept involved (e.g. GROUP BY rules, JOIN types, NULL handling)>"
}

Rules:
- If query is already correct: has_errors=false, severity="clean", issues=[], fixed_query=original query, explanation explains why it is correct
- issues array: 1-5 items max, ordered by severity
- fixed_query must be complete, working ${dialect} SQL with proper formatting
- explanation must mention the relevant SQL/DBMS concept (great for learning)`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
        })
      }
    );

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { throw new Error('Could not parse AI response. Please try again.'); }

    renderResults(query, parsed);
    scanCount++;
    sessionStorage.setItem('sql_scans', scanCount);
    updateCounter();

  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function renderResults(originalQuery, data) {
  const { has_errors, severity, summary, issues, fixed_query, changes, explanation } = data;

  const sb = document.getElementById('statusBar');
  sb.className = 'status-bar';
  const icon  = { clean: '✅', info: 'ℹ️', warning: '⚠️', critical: '🔴' };
  const cls   = { clean: 'ok', info: 'ok', warning: 'warning', critical: 'error' };
  sb.classList.add(cls[severity] || 'warning');
  document.getElementById('statusIcon').textContent  = icon[severity] || '🔍';
  document.getElementById('statusTitle').textContent = has_errors ? 'Issues Detected' : 'Query Looks Good';
  document.getElementById('statusSub').textContent   = summary || '';

  if (issues && issues.length > 0) {
    const list = document.getElementById('issuesList');
    list.innerHTML = '';
    issues.forEach(issue => {
      const card = document.createElement('div');
      card.className = `issue-card ${issue.type || 'info'}`;
      card.innerHTML = `
          <div class="issue-type">${issue.type?.toUpperCase() || 'INFO'} — ${issue.title || ''}</div>
          <div class="issue-desc">${issue.description || ''}</div>
          ${issue.hint ? `<div class="issue-hint">💡 ${issue.hint}</div>` : ''}
        `;
      list.appendChild(card);
    });
    document.getElementById('issuesWrap').style.display = 'block';
  }

  if (fixed_query) {
    const code = document.getElementById('fixedQueryCode');
    code.innerHTML = sqlHighlight(fixed_query.replace(/\n/g, '\n'));
    document.getElementById('fixedWrap').style.display = 'block';
  }

  if (changes && changes.length > 0) {
    const dv = document.getElementById('diffView');
    dv.innerHTML = '';
    changes.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'diff-row added';
      row.innerHTML = `<span class="diff-sign">+</span><span>${ch}</span>`;
      dv.appendChild(row);
    });
    const orig = document.createElement('div');
    orig.className = 'diff-row removed';
    orig.innerHTML = `<span class="diff-sign">−</span><span>Original query had ${issues?.length || '?'} issue(s)</span>`;
    dv.prepend(orig);
    document.getElementById('diffWrap').style.display = 'block';
  }

  if (explanation) {
    document.getElementById('explanationBox').textContent = explanation;
    document.getElementById('explWrap').style.display = 'block';
  }

  document.getElementById('results-section').style.display = 'block';
  setTimeout(() => {
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function sqlHighlight(code) {
  const keywords = ['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','OUTER','FULL','ON',
    'GROUP BY','ORDER BY','HAVING','INSERT','UPDATE','DELETE','CREATE','DROP','ALTER','TABLE',
    'INTO','VALUES','SET','AS','AND','OR','NOT','IN','EXISTS','LIKE','BETWEEN','IS','NULL',
    'DISTINCT','LIMIT','OFFSET','UNION','ALL','ANY','CASE','WHEN','THEN','ELSE','END',
    'COUNT','SUM','AVG','MIN','MAX','COALESCE','IFNULL','ISNULL','CAST','CONVERT',
    'PRIMARY KEY','FOREIGN KEY','REFERENCES','INDEX','VIEW','PROCEDURE','FUNCTION',
    'BEGIN','COMMIT','ROLLBACK','TRANSACTION','CONSTRAINT','DEFAULT','AUTO_INCREMENT',
    'GROUP','BY','ORDER','ASC','DESC','USING'];

  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  escaped = escaped.replace(/(--[^\n]*)/g, '<span class="cmt">$1</span>');

  escaped = escaped.replace(/('([^']*)')/g, '<span class="str">$1</span>');

  escaped = escaped.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="num">$1</span>');

  const kwSorted = [...keywords].sort((a, b) => b.length - a.length);
  kwSorted.forEach(kw => {
    const re = new RegExp(`\\b(${kw.replace(/ /g, '\\s+')})\\b`, 'gi');
    escaped = escaped.replace(re, (m) => `<span class="kw">${m}</span>`);
  });

  return escaped;
}

function copyFixed() {
  const pre = document.getElementById('fixedQueryCode');
  navigator.clipboard.writeText(pre.innerText).then(() => {
    const btn = document.querySelector('.copy-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = orig, 1800);
  });
}

function setLoading(on) {
  const loading = document.getElementById('loading');
  const btn     = document.getElementById('debugBtn');
  loading.style.display = on ? 'block' : 'none';
  btn.disabled = on;
  btn.querySelector('span').textContent = on ? '⚙ Analysing...' : '⚙ Debug My SQL Query';
  if (on) {
    startLoadingCycle();
    document.getElementById('error-box').style.display = 'none';
  } else {
    stopLoadingCycle();
  }
}

function hideResults() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('issuesWrap').style.display  = 'none';
  document.getElementById('fixedWrap').style.display   = 'none';
  document.getElementById('diffWrap').style.display    = 'none';
  document.getElementById('explWrap').style.display    = 'none';
}

function showError(msg) {
  const el = document.getElementById('error-box');
  el.textContent = '✗ ' + msg;
  el.style.display = 'block';
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') debugQuery();
});

const savedKey = sessionStorage.getItem('gemini_key_sql');
if (savedKey) document.getElementById('apiKey').value = savedKey;
document.getElementById('apiKey').addEventListener('input', e => {
  sessionStorage.setItem('gemini_key_sql', e.target.value);
});
