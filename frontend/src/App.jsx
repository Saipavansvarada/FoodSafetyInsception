import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const CATEGORIES = ['Critical', 'Major', 'Minor', 'Advisory', 'Passed'];
const STATUS = ['Pending', 'Assigned', 'In Progress', 'Resolved'];
const CATEGORY_COLORS = { Critical: '#ff6d75', Major: '#ffac67', Minor: '#e8cf68', Advisory: '#67c7c0', Passed: '#8ac99a', Unclassified: '#738397' };
const PRIORITY_COLORS = { 'P0 - Emergency': '#ff6873', 'P1 - High': '#ffad68', 'P2 - Normal': '#e9cf71', 'P3 - Low': '#63c7c0', 'P4 - Routine': '#94a8b8' };

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    route: <><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h3a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    leaf: <><path d="M20 4c-7 0-13 2-15 8-1 3 1 6 4 6 6 0 9-7 11-14Z"/><path d="M4 21c2-5 6-8 12-11"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    alert: <><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}

function Badge({ children, tone = 'slate', dot = false }) {
  return <span className={`badge badge-${tone}`}>{dot && <i />}{children}</span>;
}
function CategoryBadge({ category }) { return <Badge tone={category?.toLowerCase()} dot>{category || 'Unclassified'}</Badge>; }
function PriorityBadge({ label }) {
  const tone = label?.startsWith('P0') ? 'critical' : label?.startsWith('P1') ? 'major' : label?.startsWith('P2') ? 'minor' : label?.startsWith('P3') ? 'advisory' : 'passed';
  return <Badge tone={tone}>{label?.split(' - ')[0] || '—'}</Badge>;
}
function StatusBadge({ status }) {
  const map = { Pending: 'slate', Assigned: 'blue', 'In Progress': 'violet', Resolved: 'green' };
  return <Badge tone={map[status] || 'slate'} dot>{status}</Badge>;
}
function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <div className={`toast toast-${toast.type || 'success'}`}><span className="toast-mark">{toast.type === 'error' ? '!' : '✓'}</span><div><strong>{toast.title}</strong><small>{toast.message}</small></div><button onClick={onClose}><Icon name="close" size={15}/></button></div>;
}
function EmptyState({ title, text }) { return <div className="empty-state"><div className="empty-icon"><Icon name="file" size={22}/></div><strong>{title}</strong><span>{text}</span></div>; }
function SectionHeading({ eyebrow, title, text, action }) { return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>; }

function MiniSpark({ values = [] }) {
  const max = Math.max(1, ...values); const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${28 - (v / max) * 22}`).join(' ');
  return <svg className="mini-spark" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><polyline points={`0,31 ${points} 100,31`} fill="currentColor" opacity=".08" stroke="none"/></svg>;
}
function Donut({ rows = [] }) {
  const total = rows.reduce((a, b) => a + b.n, 0) || 1; let pos = 0;
  const pieces = rows.map(row => { const start = pos; pos += row.n / total * 100; return `${CATEGORY_COLORS[row.category] || '#75869b'} ${start}% ${pos}%`; });
  return <div className="donut-wrap"><div className="donut" style={{ background: pieces.length ? `conic-gradient(${pieces.join(',')})` : '#1b3040' }}><div className="donut-inner"><strong>{total === 1 && !rows.length ? 0 : total}</strong><span>reports</span></div></div></div>;
}
function TrendChart({ rows = [] }) {
  const ordered = [...rows].reverse(); const max = Math.max(1, ...ordered.map(r => r.n));
  const pts = ordered.map((r, i) => ({ x: 18 + (i / Math.max(1, ordered.length - 1)) * 364, y: 112 - (r.n / max) * 82 }));
  const line = pts.map(p => `${p.x},${p.y}`).join(' ');
  return <div className="trend-chart"><svg viewBox="0 0 400 145" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5cd1bb" stopOpacity=".25"/><stop offset="1" stopColor="#5cd1bb" stopOpacity="0"/></linearGradient></defs>{[30,70,110].map(y => <line key={y} x1="8" x2="392" y1={y} y2={y} stroke="rgba(153,177,199,.12)" strokeDasharray="4 5"/>)}{pts.length > 1 && <polygon points={`18,120 ${line} 382,120`} fill="url(#chartFill)"/>}<polyline points={line} fill="none" stroke="#69d7c1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3.6" fill="#07131f" stroke="#8be4d2" strokeWidth="2"/> )}</svg><div className="trend-labels">{ordered.map(r=><span key={r.day}>{r.day?.slice(5)}</span>)}</div></div>;
}

function App() {
  const [page, setPage] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [reports, setReports] = useState([]);
  const [handlers, setHandlers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [categoryFilter, setCategoryFilter] = useState('All categories');
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedHandler, setSelectedHandler] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const notify = (title, message, type = 'success') => {
    setToast({ title, message, type }); window.clearTimeout(window.__toastTimer); window.__toastTimer = window.setTimeout(() => setToast(null), 4600);
  };
  const refresh = useCallback(async (initial = false) => {
    try {
      const [d, r, h, a, c] = await Promise.all([
        api('/dashboard'), api('/reports'), api('/handlers'), api('/analytics'), api('/catalog')
      ]);
      setDashboard(d); setReports(r); setHandlers(h); setAnalytics(a); setCatalog(c); setApiOnline(true);
      if (!selectedHandler && h.length) setSelectedHandler(h.find(x => x.pool === 'DISTRICT')?.handler_id || h[0].handler_id);
    } catch (err) {
      setApiOnline(false);
      if (initial) notify('Backend unavailable', 'Start the Flask API on port 5000, then refresh this page.', 'error');
    } finally { setLoading(false); }
  }, [selectedHandler]);

  useEffect(() => { refresh(true); const id = setInterval(() => refresh(false), 18000); return () => clearInterval(id); }, [refresh]);

  const navigate = (next) => { setPage(next); setMobileNav(false); setSelectedReport(null); };
  const updateReportStatus = async (reportId, status) => {
    try {
      await api(`/reports/${reportId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      notify('Case updated', `${reportId} moved to ${status}.`); await refresh();
      if (selectedReport?.report_id === reportId) setSelectedReport(await api(`/reports/${reportId}`));
    } catch (err) { notify('Update blocked', err.message, 'error'); }
  };
  const changeHandler = async (handlerId, patch) => {
    try { await api(`/handlers/${handlerId}`, { method: 'PATCH', body: JSON.stringify(patch) }); notify('Handler updated', 'Availability and capacity have been saved.'); await refresh(); }
    catch (err) { notify('Could not update handler', err.message, 'error'); }
  };
  const runDispatch = async () => {
    try { const result = await api('/dispatch/run', { method: 'POST', body: '{}' }); notify('Dispatch cycle complete', `${result.processed} queued report(s) evaluated.`); await refresh(); }
    catch (err) { notify('Dispatch failed', err.message, 'error'); }
  };

  const filteredReports = useMemo(() => reports.filter(r => {
    const term = search.toLowerCase();
    const matchSearch = !term || [r.report_id, r.establishment, r.inspector_id, r.handler_name, r.zone_name].some(v => String(v || '').toLowerCase().includes(term));
    const matchStatus = statusFilter === 'All statuses' || r.status === statusFilter;
    const matchCategory = categoryFilter === 'All categories' || r.category === categoryFilter;
    return matchSearch && matchStatus && matchCategory;
  }), [reports, search, statusFilter, categoryFilter]);

  const navGroups = [
    { label: 'WORKSPACE', items: [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'submit', label: 'Submit report', icon: 'plus', tag: 'NEW' }, { id: 'reports', label: 'All reports', icon: 'file' }] },
    { label: 'OPERATIONS', items: [{ id: 'handler', label: 'Handler workspace', icon: 'users' }, { id: 'routing', label: 'Routing center', icon: 'route' }, { id: 'analytics', label: 'Analytics', icon: 'chart' }] },
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Icon name="shield" size={22}/><span /></div><div><strong>Food<span>Safety</span></strong><small>INSPECTION PORTAL</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><Icon name="close"/></button></div>
      <div className="workspace-pill"><div className="workspace-icon"><Icon name="leaf" size={16}/></div><div><strong>Operations HQ</strong><small>National network</small></div><span className="chevron">⌄</span></div>
      <nav className="main-nav">{navGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.tag && <em>{item.tag}</em>}{item.id === 'reports' && dashboard?.pending > 0 && <b>{dashboard.pending}</b>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="support-card"><div className="support-orb"><Icon name="shield" size={17}/></div><strong>Public health, protected.</strong><p>Every report routed. Every risk tracked.</p><div className="support-line"><span>Network status</span><Badge tone={apiOnline ? 'green' : 'critical'} dot>{apiOnline ? 'Operational' : 'Offline'}</Badge></div></div><div className="profile-mini"><div className="avatar avatar-lime">AO</div><div><strong>Admin Operator</strong><small>Portal administrator</small></div><span className="profile-more">•••</span></div></div>
    </aside>
    {mobileNav && <div className="nav-backdrop" onClick={() => setMobileNav(false)} />}

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Icon name="menu"/></button><div className="breadcrumb">Food Safety <span>/</span> <b>{({overview:'Overview',submit:'Report submission',reports:'Report registry',handler:'Handler workspace',routing:'Routing management',analytics:'Analytics'})[page]}</b></div><div className="topbar-right"><div className="system-live"><i className={apiOnline ? 'online-dot' : 'offline-dot'} />{apiOnline ? 'SYSTEM LIVE' : 'API OFFLINE'}</div><button className="icon-button" title="Notifications" onClick={() => notify('You are all caught up', 'No new system notifications.') }><Icon name="bell"/><span className="notification-dot"/></button><div className="top-user"><div className="avatar">AO</div><div><strong>Admin Operator</strong><small>Administrator</small></div><span className="chevron">⌄</span></div></div></header>

      <div className="page-content">
        {page === 'overview' && <Overview dashboard={dashboard} analytics={analytics} reports={reports} onNavigate={navigate} onSelect={setSelectedReport} loading={loading}/>}
        {page === 'submit' && <SubmitReport catalog={catalog} onCreated={async (response) => { await refresh(); setPage('reports'); if (response.report) setSelectedReport(response.report); if (response.validation.accepted) notify('Report received', `${response.report.report_id} validated and ${response.dispatch.assigned ? 'dispatched' : 'queued'}.`); else notify('Report saved — validation failed', response.validation.errors.join(' '), 'error'); }} notify={notify}/>}
        {page === 'reports' && <ReportsPage reports={filteredReports} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} onSelect={setSelectedReport} loading={loading}/>}
        {page === 'handler' && <HandlerPage handlers={handlers} reports={reports} selectedHandler={selectedHandler} setSelectedHandler={setSelectedHandler} onStatus={updateReportStatus} onRefresh={refresh}/>}
        {page === 'routing' && <RoutingPage handlers={handlers} reports={reports} onChange={changeHandler} onDispatch={runDispatch} onNavigate={navigate}/>}
        {page === 'analytics' && <AnalyticsPage analytics={analytics} dashboard={dashboard} handlers={handlers}/>}
        <footer className="page-footer"><span>FOOD SAFETY INSPECTION PORTAL <b>•</b> OPERATIONS SUITE</span><span>Built for safer food systems <span className="footer-heart">✦</span></span></footer>
      </div>
    </main>
    {selectedReport && <ReportDrawer report={selectedReport} onClose={() => setSelectedReport(null)} onStatus={updateReportStatus}/>}
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </div>;
}

function Overview({ dashboard, analytics, reports, onNavigate, onSelect, loading }) {
  const d = dashboard || {};
  const categoryRows = CATEGORIES.map(category => ({ category, n: d.categories?.find(x => x.category === category)?.n || 0 })).filter(x => x.n);
  const maxZone = Math.max(1, ...(d.zones || []).map(x => x.n));
  return <>
    <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-pulse"/> LIVE OPERATIONS OVERVIEW</div><h1>Good afternoon, Operator <span className="wave">✳</span></h1><p>Here is what is happening across your food safety network today.</p></div><div className="welcome-actions"><div className="date-chip"><Icon name="clock" size={15}/>{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</div><button className="btn-primary" onClick={() => onNavigate('submit')}><Icon name="plus" size={16}/> New inspection report</button></div></div>
    <div className="kpi-grid">
      <KpiCard label="Total reports" value={d.total ?? '—'} delta="All submissions" icon="file" accent="mint" spark={[3,4,3,6,5,8,9]}/>
      <KpiCard label="Awaiting action" value={d.pending ?? '—'} delta={`${d.queued || 0} in dispatch queue`} icon="clock" accent="amber" spark={[2,4,4,3,5,4,6]}/>
      <KpiCard label="Assigned reports" value={d.assigned ?? '—'} delta={`${d.in_progress || 0} currently in progress`} icon="route" accent="blue" spark={[1,2,3,3,4,6,5]}/>
      <KpiCard label="Resolved cases" value={d.resolved ?? '—'} delta={`${d.valid || 0} validated reports`} icon="check" accent="green" spark={[2,2,3,4,4,6,8]}/>
    </div>
    <div className="overview-grid">
      <section className="panel trend-panel"><div className="panel-head"><div><div className="eyebrow">REPORT ACTIVITY</div><h3>Inspection pulse</h3><p>Daily submissions across the network</p></div><Badge tone="green" dot>Live data</Badge></div><TrendChart rows={analytics?.daily || []} /><div className="trend-summary"><div><span className="summary-dot mint-dot"/>All reports <strong>{d.total ?? 0}</strong></div><div><span className="summary-dot coral-dot"/>Rejected <strong>{d.rejected ?? 0}</strong></div><div><span className="summary-dot blue-dot"/>Validated <strong>{d.valid ?? 0}</strong></div></div></section>
      <section className="panel category-panel"><div className="panel-head"><div><div className="eyebrow">RISK DISTRIBUTION</div><h3>Report categories</h3><p>Five-level classification</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Details <Icon name="arrow" size={14}/></button></div><div className="category-content"><Donut rows={categoryRows}/><div className="category-legend">{CATEGORIES.map(cat => { const n = d.categories?.find(x=>x.category===cat)?.n || 0; return <div key={cat}><i style={{background:CATEGORY_COLORS[cat]}}/><span>{cat}</span><strong>{n}</strong></div>; })}</div></div></section>
    </div>
    <div className="lower-grid">
      <section className="panel recent-panel"><div className="panel-head"><div><div className="eyebrow">LATEST ACTIVITY</div><h3>Recent inspection reports</h3></div><button className="text-button" onClick={() => onNavigate('reports')}>View all <Icon name="arrow" size={14}/></button></div><ReportTable reports={(d.recent || reports.slice(0,5)).slice(0,5)} onSelect={onSelect} compact/></section>
      <section className="panel zones-panel"><div className="panel-head"><div><div className="eyebrow">DISTRIBUTION</div><h3>Zone activity</h3><p>Reports by routing zone</p></div><Icon name="pin" size={17}/></div><div className="zone-bars">{(d.zones || []).length ? d.zones.slice(0,6).map(z=><div className="zone-bar-row" key={z.zone_name}><div><span>{z.zone_name}</span><strong>{z.n}</strong></div><div className="bar-track"><span style={{width:`${z.n/maxZone*100}%`}}/></div></div>) : <div className="subtle-empty">No zone activity recorded yet.</div>}</div><div className="zone-foot"><span><i className="online-dot"/> {d.available_handlers || 0} available handlers</span><button className="text-button" onClick={() => onNavigate('routing')}>Manage routing <Icon name="arrow" size={14}/></button></div></section>
    </div>
  </>;
}
function KpiCard({ label, value, delta, icon, accent, spark }) {
  return <div className={`kpi-card kpi-${accent}`}><div className="kpi-top"><span>{label}</span><div className="kpi-icon"><Icon name={icon}/></div></div><div className="kpi-value">{value}</div><div className="kpi-bottom"><span>{delta}</span><MiniSpark values={spark}/></div></div>;
}

function SubmitReport({ catalog, onCreated, notify }) {
  const [form, setForm] = useState({ inspector_id:'', violation_code:'', establishment:'', inspector_name:'', pin_code:'', description:'', urgency:'Normal' });
  const [validation, setValidation] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [touched, setTouched] = useState({});
  const update = (key, value) => { setForm(p=>({...p,[key]:value})); setValidation(null); };
  const selectedCode = catalog?.violation_codes?.[form.violation_code];
  const inspectQuick = (key) => {
    const value = form[key] || '';
    if (!value) return null;
    if (key === 'inspector_id') return /^INS[A-Z]{2}\d{4}$/.test(value) ? 'valid' : 'invalid';
    if (key === 'violation_code') return /^V\d{2}-[A-Z]{3,20}$/.test(value) && !!catalog?.violation_codes?.[value] ? 'valid' : 'invalid';
    if (key === 'pin_code') return /^\d{6}$/.test(value) ? 'valid' : 'invalid';
    return value.trim().length > 0 ? 'valid' : 'invalid';
  };
  const validate = async () => {
    setValidating(true);
    try { const result = await api('/validate', { method:'POST', body:JSON.stringify(form) }); setValidation(result); }
    catch (e) { notify('Validation service unavailable', e.message, 'error'); }
    finally { setValidating(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); setTouched(Object.fromEntries(Object.keys(form).map(k=>[k,true]))); setSubmitting(true);
    try { const result = await api('/reports', { method:'POST', body:JSON.stringify(form) }); setValidation(result.validation); onCreated(result); }
    catch (e) { notify('Submission failed', e.message, 'error'); }
    finally { setSubmitting(false); }
  };
  return <>
    <SectionHeading eyebrow="FIELD OPERATIONS / INTAKE" title="Submit an inspection report" text="Capture the inspection, validate its identifiers and let the dispatch engine take it from there." action={<Badge tone="green" dot>Secure intake</Badge>}/>
    <form className="submission-layout" onSubmit={submit}>
      <div className="form-main">
        <section className="panel form-panel"><div className="form-section-head"><div className="step-number">01</div><div><h3>Inspection & reporter details</h3><p>Who performed the inspection and where did it take place?</p></div></div><div className="form-grid">
          <Field label="Inspector full name" required value={form.inspector_name} onChange={v=>update('inspector_name',v)} placeholder="e.g. Ananya Rao" touched={touched.inspector_name}/>
          <Field label="Establishment / facility" required value={form.establishment} onChange={v=>update('establishment',v)} placeholder="Restaurant or processing unit" touched={touched.establishment}/>
          <Field label="Inspector ID" required value={form.inspector_id} onChange={v=>update('inspector_id',v.toUpperCase())} placeholder="INSAB1234" hint="Format: INS + 2 letters + 4 digits" state={inspectQuick('inspector_id')} touched={touched.inspector_id}/>
          <Field label="Facility PIN code" required value={form.pin_code} onChange={v=>update('pin_code',v.replace(/\D/g,'').slice(0,6))} placeholder="560001" hint="6 digits determine the dispatch zone" state={inspectQuick('pin_code')} touched={touched.pin_code}/>
        </div></section>
        <section className="panel form-panel"><div className="form-section-head"><div className="step-number">02</div><div><h3>Violation classification</h3><p>Select the coded observation. Category and priority are assigned automatically.</p></div></div><div className="form-grid">
          <div className="field"><label>Violation code <em>*</em></label><select value={form.violation_code} onChange={e=>update('violation_code',e.target.value)} onBlur={()=>setTouched(p=>({...p,violation_code:true}))}><option value="">Select a violation code</option>{Object.entries(catalog?.violation_codes || {}).map(([code,info])=><option value={code} key={code}>{code} · {info.domain}</option>)}</select><small>Format: V + 2 digits + category. Only mapped codes are accepted.</small>{touched.violation_code && inspectQuick('violation_code')==='invalid' && <span className="field-error">Select a supported code from the catalogue.</span>}</div>
          <div className="field"><label>Urgency level <em>*</em></label><div className="urgency-toggle"><button type="button" className={form.urgency==='Normal'?'selected':''} onClick={()=>update('urgency','Normal')}><span className="urgency-dot normal"/>Normal</button><button type="button" className={form.urgency==='Emergency'?'selected emergency-selected':''} onClick={()=>update('urgency','Emergency')}><span className="urgency-dot emergency"/>Emergency</button></div><small>Emergency applies an immediate P0 priority override.</small></div>
          <div className="field full-field"><label>Inspection observations <em>*</em></label><textarea value={form.description} onChange={e=>update('description',e.target.value)} onBlur={()=>setTouched(p=>({...p,description:true}))} placeholder="Describe what was observed, the location within the facility, evidence collected, and immediate actions taken..." rows="5"/><div className="input-meta"><small>Be specific and factual. This becomes part of the permanent case record.</small><small>{form.description.length}/1200</small></div></div>
        </div></section>
        <div className="form-actions"><button type="button" className="btn-secondary" onClick={validate} disabled={validating}>{validating?'Checking…':<><Icon name="shield" size={16}/> Validate identifiers</>}</button><button className="btn-primary" type="submit" disabled={submitting}>{submitting?'Submitting…':<>Submit & dispatch <Icon name="arrow" size={16}/></>}</button></div>
        {validation && <div className={`validation-result ${validation.accepted?'validation-ok':'validation-error'}`}><div className="validation-icon"><Icon name={validation.accepted?'check':'alert'}/></div><div><strong>{validation.accepted?'Validation passed':'Validation needs attention'}</strong><p>{validation.accepted?'Both DFA and regex validators agree. The report can be classified and routed.':(validation.errors || []).join(' ')}</p><div className="validator-chips"><Badge tone={validation.details?.inspector_id?.agreement?'green':'critical'}>Inspector DFA / Regex {validation.details?.inspector_id?.agreement?'Agree':'Mismatch'}</Badge><Badge tone={validation.details?.violation_code?.agreement?'green':'critical'}>Violation DFA / Regex {validation.details?.violation_code?.agreement?'Agree':'Mismatch'}</Badge>{validation.category && <CategoryBadge category={validation.category}/>}</div></div></div>}
      </div>
      <aside className="submission-aside"><div className="panel preview-panel"><div className="eyebrow">LIVE CLASSIFICATION</div><h3>Report preview</h3><div className="preview-code">{form.violation_code || 'V00-CATEGORY'}</div><div className="preview-domain">{selectedCode?.domain || 'Choose a violation code to preview'}</div><div className="preview-divider"/><div className="preview-row"><span>Report category</span>{selectedCode?<CategoryBadge category={selectedCode.category}/>:<span className="muted">—</span>}</div><div className="preview-row"><span>Dispatch priority</span>{selectedCode?<PriorityBadge label={form.urgency==='Emergency'?'P0 - Emergency':selectedCode.category==='Critical'?'P0 - Emergency':({Major:'P1 - High',Minor:'P2 - Normal',Advisory:'P3 - Low',Passed:'P4 - Routine'}[selectedCode.category])}/>:<span className="muted">—</span>}</div><div className="preview-row"><span>PIN zone</span><strong>{form.pin_code.length===6?({1:'North',2:'North',3:'West',4:'West',5:'South-Central',6:'South',7:'East',8:'East',9:'Special'}[form.pin_code[0]]||'Correction queue'):'Awaiting PIN'}</strong></div><div className="preview-row"><span>Validation engine</span><Badge tone="blue">DFA + Regex</Badge></div></div>
        <div className="routing-note"><div className="note-icon"><Icon name="route"/></div><div><strong>Smart dispatch enabled</strong><p>Validated reports route by PIN zone to the least-loaded available officer. No district handler receives more than 10 open cases.</p></div></div>
        <div className="mini-flow"><div className="eyebrow">AUTOMATED WORKFLOW</div><div className="flow-step"><span>1</span><div><strong>Validate</strong><small>DFA + regex checks</small></div></div><div className="flow-connector"/><div className="flow-step"><span>2</span><div><strong>Classify</strong><small>Five risk categories</small></div></div><div className="flow-connector"/><div className="flow-step"><span>3</span><div><strong>Dispatch</strong><small>Zone + capacity routing</small></div></div><div className="flow-connector"/><div className="flow-step"><span>4</span><div><strong>Track</strong><small>Live status updates</small></div></div></div>
      </aside>
    </form>
  </>;
}
function Field({ label, required, value, onChange, placeholder, hint, state, touched }) {
  return <div className="field"><label>{label}{required&&<em> *</em>}</label><div className={`input-wrap ${state==='valid'?'input-valid':state==='invalid'&&touched?'input-invalid':''}`}><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>{state==='valid'&&<span className="input-state good">✓</span>}{state==='invalid'&&touched&&<span className="input-state bad">!</span>}</div>{hint&&<small>{hint}</small>}{state==='invalid'&&touched&&<span className="field-error">Please check this field's format.</span>}</div>;
}

function ReportsPage({ reports, search, setSearch, statusFilter, setStatusFilter, categoryFilter, setCategoryFilter, onSelect, loading }) {
  return <><SectionHeading eyebrow="CASE MANAGEMENT / REGISTRY" title="Inspection reports" text="A searchable record of every submitted, validated and dispatched inspection." action={<div className="record-count"><strong>{reports.length}</strong><span>matching records</span></div>}/><section className="panel reports-panel"><div className="table-toolbar"><div className="table-search"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search report, facility, inspector or handler…"/><kbd>⌘ K</kbd></div><div className="filter-group"><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>All statuses</option>{STATUS.map(s=><option key={s}>{s}</option>)}</select><select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option>All categories</option>{CATEGORIES.map(s=><option key={s}>{s}</option>)}</select></div></div><ReportTable reports={reports} onSelect={onSelect}/>{!reports.length && <EmptyState title={loading?'Loading reports…':'No reports match your filters'} text="Try a different search term or clear the filters."/>}<div className="table-foot"><span>Showing <strong>{reports.length}</strong> report records</span><span>Sorted by priority, then latest submission</span></div></section></>;
}
function ReportTable({ reports = [], onSelect, compact = false }) {
  return <div className={`table-scroll ${compact?'compact-table':''}`}><table className="data-table"><thead><tr><th>REPORT ID</th><th>FACILITY / INSPECTOR</th><th>CATEGORY</th><th>PRIORITY</th><th>ROUTING ZONE</th><th>HANDLER</th><th>STATUS</th>{!compact&&<th>SUBMITTED</th>}</tr></thead><tbody>{reports.map(r=><tr key={r.report_id} onClick={()=>onSelect(r)}><td><button className="report-id" onClick={e=>{e.stopPropagation();onSelect(r)}}>{r.report_id}</button><small>{r.violation_code}</small></td><td><strong className="table-primary">{r.establishment || '—'}</strong><small>{r.inspector_name || r.inspector_id}</small></td><td><CategoryBadge category={r.category}/></td><td><PriorityBadge label={r.priority_label}/></td><td><span className="zone-cell"><Icon name="pin" size={13}/>{r.zone_name || 'Unmapped'}</span></td><td>{r.handler_name?<span className="handler-cell"><span className="handler-avatar">{r.handler_name.split(' ').map(x=>x[0]).slice(0,2).join('')}</span>{r.handler_name}</span>:<span className="muted">Unassigned</span>}</td><td>{r.validation_status==='Rejected'?<Badge tone="critical" dot>Rejected</Badge>:<StatusBadge status={r.status}/>}</td>{!compact&&<td className="time-cell">{formatDate(r.created_at)}</td>}</tr>)}</tbody></table></div>;
}
function formatDate(iso) { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }

function HandlerPage({ handlers, reports, selectedHandler, setSelectedHandler, onStatus }) {
  const handler = handlers.find(h=>h.handler_id===selectedHandler) || handlers[0];
  const assignments = reports.filter(r=>r.assigned_handler===handler?.handler_id).sort((a,b)=>a.priority_rank-b.priority_rank);
  return <><SectionHeading eyebrow="FIELD PERSONNEL / MY CASELOAD" title="Handler workspace" text="Review assigned inspections and progress cases through to resolution." action={<Badge tone="blue" dot>{handlers.filter(h=>h.available).length} officers available</Badge>}/><div className="handler-select-row"><div className="field handler-select"><label>Active handler view</label><select value={handler?.handler_id || ''} onChange={e=>setSelectedHandler(e.target.value)}>{handlers.map(h=><option key={h.handler_id} value={h.handler_id}>{h.name} · {h.handler_id}</option>)}</select></div>{handler&&<div className="handler-profile-inline"><div className="avatar avatar-lime">{handler.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><strong>{handler.name}</strong><small>{handler.zone_name} · {handler.pool==='DEPUTY'?'Deputy pool':'District officer'}</small></div><Badge tone={handler.available?'green':'critical'} dot>{handler.available?'Available':'Unavailable'}</Badge></div>}</div>
    {handler&&<><div className="handler-kpis"><KpiCard label="Open cases" value={handler.open_cases} delta={`of ${handler.max_open_cases} capacity`} icon="file" accent="mint" spark={[2,3,2,4,4,5,handler.open_cases||1]}/><KpiCard label="Resolved cases" value={handler.resolved_cases} delta="Completed assignments" icon="check" accent="green" spark={[1,2,2,4,3,5,7]}/><KpiCard label="Capacity remaining" value={Math.max(0,handler.max_open_cases-handler.open_cases)} delta="Available case slots" icon="users" accent="blue" spark={[8,7,7,6,5,5,4]}/></div><section className="panel assignments-panel"><div className="panel-head"><div><div className="eyebrow">PERSONAL QUEUE</div><h3>Assigned inspection cases</h3><p>Priority-ordered workload for {handler.name}</p></div><Badge tone="blue">{assignments.filter(r=>r.status!=='Resolved').length} active</Badge></div>{assignments.length?<div className="assignment-list">{assignments.map(r=><div className="assignment-item" key={r.report_id}><div className={`assignment-priority ${r.priority_rank===0?'p0':''}`}>{r.priority_rank===0?'!':r.priority_label.split(' ')[0]}</div><div className="assignment-info"><div className="assignment-title"><strong>{r.establishment}</strong><span>{r.report_id}</span></div><div className="assignment-meta"><CategoryBadge category={r.category}/><span><Icon name="pin" size={12}/>{r.zone_name}</span><span><Icon name="clock" size={12}/>{formatDate(r.created_at)}</span></div><p>{r.description}</p></div><div className="assignment-actions"><StatusBadge status={r.status}/>{r.status==='Assigned'&&<button className="btn-small" onClick={()=>onStatus(r.report_id,'In Progress')}>Start case <Icon name="arrow" size={13}/></button>}{r.status==='In Progress'&&<button className="btn-small btn-small-green" onClick={()=>onStatus(r.report_id,'Resolved')}>Resolve <Icon name="check" size={13}/></button>}{r.status==='Resolved'&&<span className="resolved-note"><Icon name="check" size={13}/> Closed</span>}</div></div>)}</div>:<EmptyState title="No assigned reports" text="New reports routed to this handler will appear here."/>}</section></>}
  </>;
}

function RoutingPage({ handlers, reports, onChange, onDispatch }) {
  const zones = useMemo(()=>{
    const list = [];
    const pinMap = {'Z1':['1','2'],'Z2':['3','4'],'Z3':['5'],'Z4':['6'],'Z5':['7','8'],'Z6':['9']};
    handlers.filter(h=>h.pool==='DISTRICT').forEach(h=>{let z=list.find(x=>x.zone_id===h.zone_id);if(!z){z={zone_id:h.zone_id,zone_name:h.zone_name,prefixes:pinMap[h.zone_id]||[],handlers:[]};list.push(z);}z.handlers.push(h);});
    return list.sort((a,b)=>a.zone_id.localeCompare(b.zone_id));
  },[handlers]);
  const queue = reports.filter(r=>r.validation_status==='Accepted'&&!r.assigned_handler&&r.status!=='Resolved').sort((a,b)=>a.priority_rank-b.priority_rank);
  return <><SectionHeading eyebrow="NETWORK CONTROL / DISPATCH ENGINE" title="Routing management" text="Monitor zone assignments, officer capacity and the live dispatch queue." action={<button className="btn-primary" onClick={onDispatch}><Icon name="route" size={16}/> Run dispatch cycle</button>}/><div className="routing-summary"><div className="routing-summary-card"><span>District handlers</span><strong>{handlers.filter(h=>h.pool==='DISTRICT').length}</strong><small>Across 6 PIN zones</small></div><div className="routing-summary-card"><span>Available officers</span><strong>{handlers.filter(h=>h.available).length}</strong><small>Ready to accept work</small></div><div className="routing-summary-card"><span>Reports queued</span><strong>{queue.length}</strong><small>Awaiting eligible handler</small></div><div className="routing-summary-card"><span>Deputy pool</span><strong>{handlers.filter(h=>h.pool==='DEPUTY').length}</strong><small>Overflow / escalation</small></div></div>
    <section className="panel routing-table-panel"><div className="panel-head"><div><div className="eyebrow">EXPLICIT ROUTING TABLE</div><h3>PIN zone → handler pool</h3><p>Least-open-cases selection · deterministic handler ID tie-break</p></div><Badge tone="blue">Max 10 open cases / officer</Badge></div><div className="zone-routing-grid">{zones.map(z=>{const total=z.handlers.reduce((a,h)=>a+h.open_cases,0);return <div className="zone-routing-card" key={z.zone_id}><div className="zone-card-head"><div><span className="zone-code">{z.zone_id}</span><strong>{z.zone_name}</strong></div><span className="pin-prefix">PIN {z.prefixes.join(' / ')}</span></div><div className="zone-load"><span>Combined active workload</span><strong>{total} cases</strong></div><div className="bar-track"><span style={{width:`${Math.min(100,total/(z.handlers.length*10)*100)}%`}}/></div><div className="zone-officers">{z.handlers.map(h=><div className="officer-row" key={h.handler_id}><div className="handler-avatar">{h.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div className="officer-info"><strong>{h.name}</strong><small>{h.handler_id} · {h.open_cases}/{h.max_open_cases} open</small></div><div className="officer-controls"><button className={`availability-toggle ${h.available?'is-on':''}`} title="Toggle availability" onClick={()=>onChange(h.handler_id,{available:!h.available,max_open_cases:h.max_open_cases})}><span/></button><span className={h.available?'available-text':'unavailable-text'}>{h.available?'On duty':'Off duty'}</span></div></div>)}</div></div>;})}</div></section>
    <div className="routing-bottom-grid"><section className="panel deputies-panel"><div className="panel-head"><div><div className="eyebrow">OVERFLOW SAFETY NET</div><h3>Deputy officer pool</h3><p>Used when district handlers are unavailable or full.</p></div><Badge tone="amber">Escalation</Badge></div>{handlers.filter(h=>h.pool==='DEPUTY').map(h=><div className="deputy-row" key={h.handler_id}><div className="handler-avatar deputy-avatar">DP</div><div className="officer-info"><strong>{h.name}</strong><small>{h.handler_id} · {h.open_cases}/{h.max_open_cases} open</small></div><button className={`availability-toggle ${h.available?'is-on':''}`} onClick={()=>onChange(h.handler_id,{available:!h.available,max_open_cases:h.max_open_cases})}><span/></button><span className={h.available?'available-text':'unavailable-text'}>{h.available?'Available':'Unavailable'}</span></div>)}<div className="policy-callout"><Icon name="shield" size={16}/><span>No officer can exceed 10 open cases. If both district and deputy capacity are exhausted, the report remains queued in priority order.</span></div></section>
      <section className="panel queue-panel"><div className="panel-head"><div><div className="eyebrow">WAITING FOR ASSIGNMENT</div><h3>Dispatch queue</h3></div><span className="queue-count">{queue.length}</span></div>{queue.length?queue.slice(0,5).map(r=><div className="queue-row" key={r.report_id}><PriorityBadge label={r.priority_label}/><div><strong>{r.report_id}</strong><small>{r.establishment}</small></div><span>{r.zone_name||'Correction queue'}</span></div>):<EmptyState title="Queue is clear" text="All validated reports have an assignment."/>}</section></div>
  </>;
}

function AnalyticsPage({ analytics, dashboard, handlers }) {
  const a=analytics||{};const maxZone=Math.max(1,...(a.zones||[]).map(x=>x.n));const maxHandler=Math.max(1,...(a.handlers||[]).map(x=>x.open_cases));
  const categoryRows=CATEGORIES.map(category=>({category,n:a.categories?.find(x=>x.category===category)?.n||0}));
  return <><SectionHeading eyebrow="INTELLIGENCE / PERFORMANCE" title="Network analytics" text="Understand risk patterns, zone distribution and the performance of your response network." action={<Badge tone="green" dot>Updated live</Badge>}/><div className="analytics-kpis"><KpiCard label="Validation success" value={`${dashboard?.total?Math.round(dashboard.valid/dashboard.total*100):0}%`} delta={`${dashboard?.valid||0} accepted reports`} icon="shield" accent="mint" spark={[5,7,7,8,8,9,9]}/><KpiCard label="Resolution rate" value={`${dashboard?.total?Math.round(dashboard.resolved/dashboard.total*100):0}%`} delta={`${dashboard?.resolved||0} resolved`} icon="check" accent="green" spark={[2,2,3,4,5,6,7]}/><KpiCard label="Dispatch coverage" value={`${dashboard?.valid?Math.round((dashboard.valid-(dashboard.queued||0))/dashboard.valid*100):0}%`} delta="Accepted reports assigned" icon="route" accent="blue" spark={[4,5,6,6,8,8,9]}/></div>
    <div className="analytics-grid"><section className="panel"><div className="panel-head"><div><div className="eyebrow">RISK LANDSCAPE</div><h3>Category breakdown</h3><p>Accepted reports by classification</p></div></div><div className="analytics-category-list">{categoryRows.map(row=><div className="analytics-category" key={row.category}><div className="analytics-cat-top"><span><i style={{background:CATEGORY_COLORS[row.category]}}/>{row.category}</span><strong>{row.n}</strong></div><div className="bar-track"><span style={{width:`${Math.max(0,row.n/Math.max(1,dashboard?.valid||1)*100)}%`,background:CATEGORY_COLORS[row.category]}}/></div></div>)}</div></section><section className="panel"><div className="panel-head"><div><div className="eyebrow">GEOGRAPHIC COVERAGE</div><h3>Zone-wise reports</h3><p>Where inspections are being filed</p></div></div><div className="zone-bars analytics-zone-bars">{(a.zones||[]).map(z=><div className="zone-bar-row" key={z.zone_name}><div><span>{z.zone_name}</span><strong>{z.n}</strong></div><div className="bar-track"><span style={{width:`${z.n/maxZone*100}%`}}/></div></div>)}</div></section></div>
    <div className="analytics-grid"><section className="panel"><div className="panel-head"><div><div className="eyebrow">CASE OUTCOMES</div><h3>Status distribution</h3></div></div><div className="status-stat-list">{STATUS.map(s=>{const n=a.statuses?.find(x=>x.status===s)?.n||0;return <div key={s}><StatusBadge status={s}/><strong>{n}</strong></div>;})}</div></section><section className="panel"><div className="panel-head"><div><div className="eyebrow">TEAM LOAD</div><h3>Handler workload</h3><p>Active open cases by handler</p></div></div><div className="handler-workload">{(a.handlers||[]).slice(0,6).map(h=><div className="workload-row" key={h.handler_id}><span>{h.name}</span><div className="bar-track"><span style={{width:`${h.open_cases/maxHandler*100}%`}}/></div><strong>{h.open_cases}</strong></div>)}</div></section></div>
  </>;
}

function ReportDrawer({ report, onClose, onStatus }) {
  const [busy,setBusy]=useState(false);
  const change=async status=>{setBusy(true);await onStatus(report.report_id,status);setBusy(false);};
  return <><div className="drawer-backdrop" onClick={onClose}/><aside className="report-drawer"><div className="drawer-top"><div><div className="eyebrow">CASE DETAIL / {report.report_id}</div><h2>Inspection record</h2></div><button className="icon-button" onClick={onClose}><Icon name="close"/></button></div><div className="drawer-tags"><CategoryBadge category={report.category}/><PriorityBadge label={report.priority_label}/>{report.validation_status==='Rejected'?<Badge tone="critical">Rejected</Badge>:<StatusBadge status={report.status}/>}</div><h3 className="drawer-facility">{report.establishment}</h3><p className="drawer-description">{report.description}</p><div className="detail-grid"><Detail label="Inspector" value={report.inspector_name}/><Detail label="Inspector ID" value={report.inspector_id}/><Detail label="Violation code" value={report.violation_code}/><Detail label="Domain" value={report.domain}/><Detail label="PIN code" value={report.pin_code}/><Detail label="Routing zone" value={report.zone_name||'Unmapped'}/><Detail label="Assigned handler" value={report.handler_name||'Unassigned'}/><Detail label="Submitted" value={formatDate(report.created_at)}/><Detail label="Routed at" value={formatDate(report.routed_at)}/><Detail label="Assignment" value={report.assignment_status}/><Detail label="Urgency" value={report.urgency}/></div><div className="drawer-divider"/><div className="drawer-block"><div className="eyebrow">VALIDATION AUDIT</div><div className="audit-row"><span>Inspector ID DFA / Regex</span><Badge tone={report.validation_details?.inspector_id?.agreement?'green':'critical'}>{report.validation_details?.inspector_id?.agreement?'Agreed':'Rejected'}</Badge></div><div className="audit-row"><span>Violation code DFA / Regex</span><Badge tone={report.validation_details?.violation_code?.agreement?'green':'critical'}>{report.validation_details?.violation_code?.agreement?'Agreed':'Rejected'}</Badge></div><p className="audit-reason">{report.validation_reason}</p></div>{report.route_reason&&<div className="drawer-block"><div className="eyebrow">ROUTING DECISION</div><p className="audit-reason">{report.route_reason}</p></div>}<div className="drawer-bottom"><span className="muted">Update case status</span>{report.validation_status==='Rejected'?<Badge tone="critical">Not dispatchable</Badge>:<div className="drawer-status-buttons">{report.status==='Assigned'&&<button className="btn-primary" disabled={busy} onClick={()=>change('In Progress')}>Start work</button>}{report.status==='In Progress'&&<button className="btn-primary" disabled={busy} onClick={()=>change('Resolved')}>Mark resolved</button>}{report.status==='Pending'&&<Badge tone="amber">Waiting for assignment</Badge>}{report.status==='Resolved'&&<Badge tone="green">Case closed</Badge>}</div>}</div></aside></>;
}
function Detail({label,value}){return <div className="detail-item"><small>{label}</small><strong>{value||'—'}</strong></div>}

export default App;
