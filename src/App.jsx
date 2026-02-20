/**
 * Smart Loan & Finance Planner — v4
 * ═══════════════════════════════════════════════════════════════════════
 * TAB 1  Loan Planner   — reducing-balance EMI, deferment, prepayments
 * TAB 2  Finance Diary  — date-stamped income & expense entries, each
 *                         with their own currency; a single "Display
 *                         Currency" selector on the dashboard converts
 *                         every value on-the-fly via AED-pivot FX rates.
 *                         Savings defaults to (income − expenses) and
 *                         can be edited then saved per month.
 * All data lives in localStorage — zero backend.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ─── CURRENCIES & FX ─────────────────────────────────────────────────────────
const CURRENCIES = [
  { code:"AED", sym:"AED", name:"UAE Dirham"      },
  { code:"USD", sym:"$",   name:"US Dollar"       },
  { code:"EUR", sym:"€",   name:"Euro"            },
  { code:"GBP", sym:"£",   name:"British Pound"   },
  { code:"INR", sym:"₹",   name:"Indian Rupee"    },
  { code:"SAR", sym:"SAR", name:"Saudi Riyal"     },
  { code:"KWD", sym:"KWD", name:"Kuwaiti Dinar"   },
  { code:"QAR", sym:"QAR", name:"Qatari Riyal"    },
  { code:"BHD", sym:"BHD", name:"Bahraini Dinar"  },
  { code:"OMR", sym:"OMR", name:"Omani Rial"      },
];
const FX = { AED:1, USD:3.6725, EUR:3.982, GBP:4.64, INR:0.0441, SAR:0.979, KWD:11.97, QAR:1.009, BHD:9.74, OMR:9.54 };
const cx  = (amt, from, to) => !amt ? 0 : ((+amt||0)*(FX[from]||1))/(FX[to]||1);
const cSym = code => CURRENCIES.find(c=>c.code===code)?.sym ?? code;

// ─── CATEGORY LISTS ───────────────────────────────────────────────────────────
const INC_TYPES  = ["Salary","Investment Return","Rental Income","Bonus","Freelance","Dividend","Gift / Transfer","Other"];
const EXP_CATS   = ["Rent / Mortgage","Electricity","Water","Internet / Phone","School Fees",
  "School Transport","Grocery","Credit Card Payment","Chitty / Chit Fund","Insurance",
  "Car Loan EMI","Fuel","Medical / Pharmacy","Dining Out","Subscription (OTT)",
  "Clothing","Travel","Entertainment","Other"];
const PIE_PAL    = ["#f59e0b","#38bdf8","#34d399","#f472b6","#a78bfa","#fb923c",
                    "#22d3ee","#86efac","#fbbf24","#c084fc","#60a5fa","#4ade80","#f87171","#818cf8"];

// ─── DATE / FORMAT HELPERS ────────────────────────────────────────────────────
const MOS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NOW    = new Date();
const TODAY  = NOW.toISOString().slice(0,10);
const mk     = (y,m) => `${y}-${String(m+1).padStart(2,"0")}`;       // month-key YYYY-MM
const mkLbl  = k => { const [y,m]=k.split("-"); return `${MOS[+m-1]} ${y}`; };
const d2mk   = s => s?.slice(0,7)??"";
const byDate = arr => [...arr].sort((a,b)=>b.date?.localeCompare(a.date));

const f2 = (n,s="",d=2) =>
  `${s}${(+n||0).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d})}`;
const fK  = (n,s="") => {
  const v=Math.abs(+n||0);
  return v>=1e6?`${s}${((+n)/1e6).toFixed(1)}M`:v>=1e3?`${s}${((+n)/1e3).toFixed(1)}K`:f2(n,s);
};

// ─── LOAN MATH ────────────────────────────────────────────────────────────────
const emi    = (P,r,n) => { if(!P||!n) return 0; const mr=r/12/100; if(!mr) return P/n; const f=Math.pow(1+mr,n); return P*mr*f/(f-1); };
const tenure = (P,r,e) => { const mr=r/12/100; if(!mr) return Math.ceil(P/e); const x=P*mr/e; if(x>=1) return Infinity; return Math.ceil(-Math.log(1-x)/Math.log(1+mr)); };

// Convert YYYY-MM string to repayment-month index (1-based) given startD
const ymToRepayMonth = (ym, startD, defer) => {
  if (!startD || !ym) return 0;
  const [sy,sm] = startD.split("-").map(Number);
  const [py,pm2] = ym.split("-").map(Number);
  const diffM = (py - sy)*12 + (pm2 - sm); // offset from loan start
  const repayM = diffM - defer + 1;         // subtract deferment months → repay-phase index
  return repayM > 0 ? repayM : 0;
};

// Expand prepayment rules into a map of { repayMonth -> {amount, type, label} }
const expandPreps = (preps, maxMonths, startD, defer) => {
  const pm = {};
  preps.forEach(p => {
    if (!p.amount || +p.amount <= 0) return;
    const mode = p.mode || "once"; // "once" | "monthly" | "interval" | "range"

    if (mode === "once") {
      // One-time at specific month/year or month number
      let rm = 0;
      if (p.ym && startD) rm = ymToRepayMonth(p.ym, startD, defer);
      else rm = +p.month || 0;
      if (rm > 0) pm[rm] = {amount:+p.amount, type:p.type||"tenure", label:p.ym||`M${rm}`};

    } else if (mode === "monthly") {
      // Every month from startYm to optional endYm (or end of loan)
      let startRm = 1, endRm = maxMonths;
      if (p.startYm && startD) startRm = Math.max(1, ymToRepayMonth(p.startYm, startD, defer));
      if (p.endYm   && startD) endRm   = Math.min(maxMonths, ymToRepayMonth(p.endYm, startD, defer));
      else if (p.endYm && !startD) endRm = Math.min(maxMonths, +p.endYm || maxMonths);
      for (let rm = startRm; rm <= endRm; rm++) {
        pm[rm] = {amount:+p.amount, type:p.type||"tenure", label:`Every month`};
      }

    } else if (mode === "interval") {
      // Every N months from startYm
      const interval = Math.max(1, +p.interval || 1);
      let startRm = 1;
      if (p.startYm && startD) startRm = Math.max(1, ymToRepayMonth(p.startYm, startD, defer));
      let endRm = maxMonths;
      if (p.endYm && startD) endRm = Math.min(maxMonths, ymToRepayMonth(p.endYm, startD, defer));
      for (let rm = startRm; rm <= endRm; rm += interval) {
        pm[rm] = {amount:+p.amount, type:p.type||"tenure", label:`Every ${interval}mo`};
      }
    }
  });
  return pm;
};

const buildSched = (P, rate, months, preps, startD, defer) => {
  const mr = rate/12/100; let bal = P; const rows = []; let dInt = 0;
  for (let i = 1; i <= defer; i++) {
    const op = bal, int = bal*mr; dInt += int; bal += int;
    let dl = `Defer ${i}`;
    if (startD) { const d=new Date(startD+"-01"); d.setMonth(d.getMonth()+i-1); dl=d.toLocaleDateString("en-US",{month:"short",year:"numeric"}); }
    rows.push({month:i,date:dl,phase:"deferment",opening:op,interest:int,emi:0,principal:0,prepay:0,closing:bal,curEMI:0});
  }
  let e = emi(bal,rate,months), remM = months;
  const pm = expandPreps(preps, months+600, startD, defer);
  let tInt = dInt, rm = 1;
  while (bal > 0.01 && rm <= months+600) {
    const gm=defer+rm, op=bal, int=bal*mr, princ=Math.min(e-int,bal), aEMI=Math.min(e,bal+int);
    bal -= princ;
    const pp = pm[rm]; let pay = 0;
    if (pp && bal > 0.01) {
      pay = Math.min(pp.amount, bal); bal -= pay;
      if (bal > 0.01) { const ml=remM-rm; if(ml>0) { if(pp.type==="emi") e=emi(bal,rate,ml); else remM=rm+tenure(bal,rate,e); } }
    }
    const cl = Math.max(bal,0); tInt += int;
    let dl = `M${gm}`;
    if (startD) { const d=new Date(startD+"-01"); d.setMonth(d.getMonth()+gm-1); dl=d.toLocaleDateString("en-US",{month:"short",year:"numeric"}); }
    const noteLabel = pp ? `Prepay ${pp.label} — ${pp.type==="emi"?"EMI ↓":"Tenure ↓"}` : "";
    rows.push({month:gm,repayM:rm,date:dl,phase:"repay",opening:op,interest:int,emi:aEMI,principal:princ,prepay:pay,closing:cl,curEMI:e,note:noteLabel});
    if (cl < 0.01) break; rm++;
  }
  return {rows,defer,dInt,tInt,totalM:rows.length,repayM:rm-1,postEMI:e};
};

// ─── SHARED UI ATOMS ─────────────────────────────────────────────────────────

const TF = ({label,value,onChange,type="number",min,step,placeholder,dark,sfx,disabled,cls=""}) => (
  <div className={`flex flex-col gap-1 ${cls}`}>
    {label&&<label className={`text-xs font-semibold uppercase tracking-widest ${dark?"text-amber-400":"text-slate-500"}`}>{label}</label>}
    <div className="relative">
      <input type={type} value={value??""} min={min} step={step} placeholder={placeholder} disabled={disabled}
        onChange={e=>onChange(e.target.value)}
        className={`w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none focus:ring-2 transition-all
          ${disabled?"opacity-40 cursor-not-allowed":""}
          ${dark?"bg-slate-800 border-slate-600 text-white focus:ring-amber-500 focus:border-amber-500"
               :"bg-white border-slate-200 text-slate-800 focus:ring-blue-400 focus:border-blue-400"}
          ${sfx?"pr-12":""}`}/>
      {sfx&&<span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60`}>{sfx}</span>}
    </div>
  </div>
);

const DD = ({label,value,onChange,opts,dark,cls=""}) => (
  <div className={`flex flex-col gap-1 ${cls}`}>
    {label&&<label className={`text-xs font-semibold uppercase tracking-widest ${dark?"text-amber-400":"text-slate-500"}`}>{label}</label>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      className={`w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none focus:ring-2 transition-all
        ${dark?"bg-slate-800 border-slate-600 text-white focus:ring-amber-500":"bg-white border-slate-200 text-slate-800 focus:ring-blue-400"}`}>
      {opts.map(o=>typeof o==="string"?<option key={o}>{o}</option>:<option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>
);

const CurDD = ({label,value,onChange,dark,cls=""}) => (
  <DD label={label} value={value} onChange={onChange} dark={dark} cls={cls}
    opts={CURRENCIES.map(c=>({v:c.code,l:`${c.code} — ${c.name}`}))}/>
);

const Card = ({children,dark,cls=""}) => (
  <div className={`rounded-2xl border ${dark?"bg-slate-900 border-slate-800":"bg-white border-slate-100 shadow-sm"} ${cls}`}>
    {children}
  </div>
);

const KPI = ({label,value,sub,icon,dark,clr}) => (
  <div className={`rounded-xl p-4 border ${dark?"bg-slate-800 border-slate-700":"bg-white border-slate-100 shadow-sm"}`}>
    <div className="flex items-start justify-between">
      <div>
        <p className={`text-xs uppercase tracking-widest font-semibold mb-0.5 ${dark?"text-slate-400":"text-slate-500"}`}>{label}</p>
        <p className={`text-base font-bold font-mono leading-tight ${clr??(dark?"text-white":"text-slate-800")}`}>{value}</p>
        {sub&&<p className={`text-xs mt-1 ${dark?"text-slate-500":"text-slate-400"}`}>{sub}</p>}
      </div>
      {icon&&<span className="text-xl opacity-60 mt-0.5">{icon}</span>}
    </div>
  </div>
);

const CTip = ({active,payload,label,dark,sym=""}) => {
  if(!active||!payload?.length) return null;
  return <div className={`rounded-lg p-3 shadow-xl border text-xs ${dark?"bg-slate-900 border-slate-700 text-white":"bg-white border-slate-200"}`}>
    <p className="font-bold mb-1">{label}</p>
    {payload.map((p,i)=><p key={i} style={{color:p.color}}>{p.name}: {f2(p.value,sym)}</p>)}
  </div>;
};

// ════════════════════════════════════════════════════════════════════════════════
//  FINANCE TAB
// ════════════════════════════════════════════════════════════════════════════════
function FinanceTab({dark, user}) {

  // ── display currency ────────────────────────────────────────────────────────
  const [dispCur, setDispCur] = useState(()=>uGet(user,"f_dc","AED"));
  useEffect(()=>uSet(user,"f_dc",dispCur),[dispCur,user]);
  const DC = CURRENCIES.find(c=>c.code===dispCur)||CURRENCIES[0];
  const S  = DC.sym; // display symbol

  // ── salary config ────────────────────────────────────────────────────────────
  const [salAmt,  setSalAmt]  = useState(()=>+(uGet(user,"f_sa",0)));
  const [salCur,  setSalCur]  = useState(()=>uGet(user,"f_sc","AED"));
  const [salDay,  setSalDay]  = useState(()=>uGet(user,"f_sd","1"));
  useEffect(()=>uSet(user,"f_sa",salAmt),[salAmt,user]);
  useEffect(()=>uSet(user,"f_sc",salCur),[salCur,user]);
  useEffect(()=>uSet(user,"f_sd",salDay),[salDay,user]);

  // ── petty cash default ───────────────────────────────────────────────────────
  const [pettyDef, setPettyDef] = useState(()=>+(uGet(user,"f_pd",500)));
  useEffect(()=>uSet(user,"f_pd",pettyDef),[pettyDef,user]);

  // ── income entries [{id,date,type,label,amount,currency,note}] ───────────────
  const [incs, setIncs] = useState(()=>uGet(user,"f_incs",[]));
  useEffect(()=>uSet(user,"f_incs",incs),[incs,user]);

  // ── expense entries [{id,date,category,label,amount,currency,note}] ──────────
  const [exps, setExps] = useState(()=>uGet(user,"f_exps",[]));
  useEffect(()=>uSet(user,"f_exps",exps),[exps,user]);

  // ── savings per month-key {mk:{savedAmt,savedCur,customEdited,pettyBudget,pettySpent}} ─
  const [savMap, setSavMap] = useState(()=>uGet(user,"f_sav",{}));
  useEffect(()=>uSet(user,"f_sav",savMap),[savMap,user]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [view,  setView]  = useState("entry");   // "entry" | "dash"
  const [sec,   setSec]   = useState("income");  // "income"|"expense"|"savings"|"petty"
  const [selY,  setSelY]  = useState(NOW.getFullYear());
  const [selM,  setSelM]  = useState(NOW.getMonth()); // 0-based
  const curMK = mk(selY, selM);

  // ── new-entry form state ──────────────────────────────────────────────────────
  const emptyInc = {date:TODAY, type:"Investment Return", label:"", amount:"", currency:dispCur, note:""};
  const emptyExp = {date:TODAY, category:EXP_CATS[0], customCat:"", label:"", amount:"", currency:dispCur, note:""};
  const [nInc, setNInc] = useState(emptyInc);
  const [nExp, setNExp] = useState(emptyExp);

  // ── month navigation ─────────────────────────────────────────────────────────
  const prevM = () => { const d=new Date(selY,selM-1,1); setSelY(d.getFullYear()); setSelM(d.getMonth()); };
  const nextM = () => { const d=new Date(selY,selM+1,1); setSelY(d.getFullYear()); setSelM(d.getMonth()); };

  // ── filtered entries for selected month ──────────────────────────────────────
  const mIncs = useMemo(()=>incs.filter(i=>d2mk(i.date)===curMK),[incs,curMK]);
  const mExps = useMemo(()=>exps.filter(e=>d2mk(e.date)===curMK),[exps,curMK]);

  // ── totals in display currency ────────────────────────────────────────────────
  const salDC    = cx(salAmt, salCur, dispCur);
  const incsDC   = useMemo(()=>mIncs.reduce((s,i)=>s+cx(i.amount,i.currency,dispCur),0),[mIncs,dispCur]);
  const expsDC   = useMemo(()=>mExps.reduce((s,e)=>s+cx(e.amount,e.currency,dispCur),0),[mExps,dispCur]);
  const totalInDC  = salDC + incsDC;
  const netDC      = totalInDC - expsDC;

  // ── savings record for selected month ────────────────────────────────────────
  const savRec = savMap[curMK] || {savedAmt: netDC, savedCur: dispCur, customEdited: false, pettyBudget: pettyDef, pettySpent:0};
  // auto-update savedAmt from net when NOT custom-edited
  const dispSavedDC = savRec.customEdited
    ? cx(savRec.savedAmt, savRec.savedCur, dispCur)
    : netDC;

  // editing state for savings box
  const [savEdit, setSavEdit] = useState(false);
  const [savInput, setSavInput] = useState("");
  const [savInputCur, setSavInputCur] = useState(dispCur);

  const startEditSav = () => {
    setSavInput(f2(dispSavedDC,"",2));
    setSavInputCur(dispCur);
    setSavEdit(true);
  };
  const cancelSav = () => setSavEdit(false);
  const saveSav = () => {
    setSavMap(p=>({...p,[curMK]:{
      ...(p[curMK]||{}),
      savedAmt: +savInput||0,
      savedCur: savInputCur,
      customEdited: true,
      pettyBudget: savRec.pettyBudget,
      pettySpent:  savRec.pettySpent,
    }}));
    setSavEdit(false);
  };
  const resetSav = () => {
    setSavMap(p=>({...p,[curMK]:{...(p[curMK]||{}), customEdited:false}}));
    setSavEdit(false);
  };

  // petty helpers
  const pettyBudDC  = savRec.pettyBudget ?? pettyDef;
  const pettySpentDC= savRec.pettySpent  ?? 0;
  const pettyLeftDC = pettyBudDC - pettySpentDC;
  const pettyPct    = pettyBudDC>0 ? Math.min(100,Math.round(pettySpentDC/pettyBudDC*100)) : 0;
  const updPetty = upd => setSavMap(p=>({...p,[curMK]:{...(p[curMK]||{}),pettyBudget:savRec.pettyBudget,pettySpent:savRec.pettySpent,...upd}}));

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const addInc = () => {
    if(!+nInc.amount) return;
    setIncs(p=>[...p,{...nInc, id:Date.now(), amount:+nInc.amount, label:nInc.label||nInc.type}]);
    setNInc(emptyInc);
  };
  const delInc = id => setIncs(p=>p.filter(i=>i.id!==id));
  const addExp = () => {
    if(!+nExp.amount) return;
    const cat = nExp.category==="Custom" ? nExp.customCat||"Custom" : nExp.category;
    setExps(p=>[...p,{...nExp, id:Date.now(), amount:+nExp.amount, category:cat, label:nExp.label||cat}]);
    setNExp(emptyExp);
  };
  const delExp = id => setExps(p=>p.filter(e=>e.id!==id));

  // ── DASHBOARD DATA ────────────────────────────────────────────────────────────
  const allMKs = useMemo(()=>{
    const s=new Set();
    [...incs,...exps].forEach(x=>{if(x.date) s.add(d2mk(x.date));});
    Object.keys(savMap).forEach(k=>s.add(k));
    for(let i=0;i<13;i++){const d=new Date(NOW.getFullYear(),NOW.getMonth()-i,1);s.add(mk(d.getFullYear(),d.getMonth()));}
    return[...s].filter(Boolean).sort();
  },[incs,exps,savMap]);

  const dashRows = useMemo(()=>allMKs.map(k=>{
    const mi=incs.filter(i=>d2mk(i.date)===k);
    const me=exps.filter(e=>d2mk(e.date)===k);
    const inc= cx(salAmt,salCur,dispCur) + mi.reduce((s,i)=>s+cx(i.amount,i.currency,dispCur),0);
    const exp= me.reduce((s,e)=>s+cx(e.amount,e.currency,dispCur),0);
    const sv = savMap[k];
    const saved = sv?.customEdited ? cx(sv.savedAmt,sv.savedCur,dispCur) : (inc-exp);
    return{k, label:mkLbl(k), inc:Math.round(inc), exp:Math.round(exp), net:Math.round(inc-exp), saved:Math.round(saved), hasSav:!!sv?.customEdited};
  }),[allMKs,incs,exps,savMap,salAmt,salCur,dispCur]);

  const totalSaved  = dashRows.reduce((s,r)=>s+Math.max(0,r.saved),0);
  const savedMonths = dashRows.filter(r=>r.saved>0).length;
  const avgSaved    = savedMonths>0 ? totalSaved/savedMonths : 0;

  // expense breakdown pie for selected month
  const expPie = useMemo(()=>{
    const m={};
    mExps.forEach(e=>{ const v=cx(e.amount,e.currency,dispCur); m[e.category]=(m[e.category]||0)+v; });
    return Object.entries(m).map(([n,v])=>({name:n,value:Math.round(v)})).filter(x=>x.value>0);
  },[mExps,dispCur]);

  // ── STYLES ───────────────────────────────────────────────────────────────────
  const crd  = dark?"bg-slate-900 border-slate-800":"bg-white border-slate-100 shadow-sm";
  const tOn  = dark?"bg-amber-500 text-slate-900 font-black":"bg-blue-600 text-white font-black";
  const tOff = dark?"text-slate-400 hover:text-amber-300":"text-slate-500 hover:text-blue-600";
  const Hdr  = ({t}) => <h3 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>{t}</h3>;
  const Div  = ({c}) => <div className={`my-3 border-t ${dark?"border-slate-700":"border-slate-100"}`} />;

  // FX rate note
  const fxNote = CURRENCIES.filter(c=>c.code!==dispCur).slice(0,5)
    .map(c=>`1 ${c.code} = ${f2(cx(1,c.code,dispCur),"",4)} ${dispCur}`).join("  ·  ");

  return (
    <div className="space-y-5">

      {/* ── TOP BAR: nav + display currency ──────────────────────────────────── */}
      <div className={`rounded-2xl border p-3 flex flex-wrap items-center justify-between gap-3 ${crd}`}>
        <div className="flex gap-1">
          {[{id:"entry",l:"📝 Monthly Entry"},{id:"dash",l:"📊 Dashboard"}].map(t=>(
            <button key={t.id} onClick={()=>setView(t.id)}
              className={`px-4 py-2 text-xs rounded-xl transition-all ${view===t.id?tOn:tOff}`}>{t.l}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold uppercase tracking-widest ${dark?"text-slate-400":"text-slate-500"}`}>Display Currency:</span>
          <select value={dispCur} onChange={e=>setDispCur(e.target.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-mono border outline-none focus:ring-2
              ${dark?"bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-500"
                   :"bg-slate-50 border-blue-200 text-blue-700 focus:ring-blue-400"}`}>
            {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
          <span className={`text-lg font-black ${dark?"text-amber-400":"text-blue-600"}`}>{S}</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          ENTRY VIEW
      ══════════════════════════════════════════════════════════════════════════ */}
      {view==="entry" && (<>

        {/* Month header + KPI strip */}
        <div className={`rounded-2xl border p-5 ${crd}`}>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h3 className={`text-lg font-black ${dark?"text-white":"text-slate-800"}`}>
              {MOS[selM]} {selY}
            </h3>
            <div className="flex gap-2">
              <button onClick={prevM} className={`px-3 py-1.5 rounded-lg text-xs border ${dark?"border-slate-700 text-slate-300 hover:bg-slate-800":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>‹ Prev</button>
              <button onClick={()=>{setSelY(NOW.getFullYear());setSelM(NOW.getMonth());}}
                className={`px-3 py-1.5 rounded-lg text-xs border font-bold ${dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10":"border-blue-200 text-blue-600 hover:bg-blue-50"}`}>Today</button>
              <button onClick={nextM} className={`px-3 py-1.5 rounded-lg text-xs border ${dark?"border-slate-700 text-slate-300 hover:bg-slate-800":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>Next ›</button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPI label="Total Income"    value={f2(totalInDC,S)}  icon="💵" dark={dark} clr={dark?"text-green-400":"text-green-600"}
              sub={`Salary ${fK(salDC,S)} + other ${fK(incsDC,S)}`}/>
            <KPI label="Total Expenses"  value={f2(expsDC,S)}     icon="📤" dark={dark} clr={dark?"text-red-400":"text-red-500"}
              sub={`${mExps.length} entries`}/>
            <KPI label="Net Balance"     value={f2(netDC,S)}      icon="⚖️" dark={dark}
              clr={netDC>=0?(dark?"text-green-400":"text-green-600"):(dark?"text-red-400":"text-red-500")}/>
            <KPI label="Petty Remaining" value={f2(pettyLeftDC,S)} icon="🪙" dark={dark}
              clr={pettyLeftDC>=0?(dark?"text-amber-400":"text-amber-600"):(dark?"text-red-400":"text-red-500")}
              sub={`of ${f2(pettyBudDC,S)} budget`}/>
          </div>
          <p className={`text-xs mt-3 ${dark?"text-slate-600":"text-slate-400"}`}>
            All values → <strong>{dispCur}</strong>. Approx rates: {fxNote}
          </p>
        </div>

        {/* Section tabs */}
        <div className={`rounded-2xl border p-2 flex gap-1 flex-wrap ${crd}`}>
          {[{id:"income",l:"💵 Income"},{id:"expense",l:"💳 Expenses"},
            {id:"savings",l:"🏦 Savings"},{id:"petty",l:"🪙 Petty Cash"}].map(s=>(
            <button key={s.id} onClick={()=>setSec(s.id)}
              className={`flex-1 py-2 text-xs rounded-xl transition-all min-w-[90px] ${sec===s.id?tOn:tOff}`}>{s.l}</button>
          ))}
        </div>

        {/* ─── INCOME ────────────────────────────────────────────────────────── */}
        {sec==="income" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* ADD INCOME */}
            <div className={`rounded-2xl border p-5 space-y-4 ${crd}`}>
              <Hdr t="➕ Add Income" />

              {/* Salary block */}
              <div className={`rounded-xl p-4 border ${dark?"border-amber-700/30 bg-amber-950/20":"border-amber-100 bg-amber-50"}`}>
                <p className={`text-xs font-black uppercase tracking-wider mb-3 ${dark?"text-amber-400":"text-amber-600"}`}>💼 Monthly Salary (fixed)</p>
                <div className="grid grid-cols-3 gap-3">
                  <TF label="Amount" value={salAmt} onChange={v=>setSalAmt(+v)} min={0} dark={dark} cls="col-span-1"/>
                  <DD label="Currency" value={salCur} onChange={setSalCur} dark={dark}
                    opts={CURRENCIES.map(c=>({v:c.code,l:c.code}))} cls="col-span-1"/>
                  <TF label="Paid on Day" value={salDay} onChange={setSalDay} min={1} max={31} dark={dark} cls="col-span-1"/>
                </div>
                {salCur!==dispCur && salAmt>0 && (
                  <p className={`text-xs mt-2 ${dark?"text-slate-500":"text-slate-400"}`}>
                    ≈ {f2(salDC,S)} {dispCur} / month
                  </p>
                )}
              </div>

              {/* Additional income */}
              <div className={`rounded-xl p-4 border ${dark?"border-slate-700 bg-slate-800/50":"border-slate-100 bg-slate-50"}`}>
                <p className={`text-xs font-black uppercase tracking-wider mb-3 ${dark?"text-slate-300":"text-slate-600"}`}>📈 Other Income Entry</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <TF label="Date" value={nInc.date} onChange={v=>setNInc(n=>({...n,date:v}))} type="date" dark={dark}/>
                    <DD label="Type" value={nInc.type} onChange={v=>setNInc(n=>({...n,type:v}))} opts={INC_TYPES} dark={dark}/>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <TF label="Label / Source" value={nInc.label} onChange={v=>setNInc(n=>({...n,label:v}))}
                      type="text" placeholder="e.g. HDFC Mutual Fund" dark={dark}/>
                    <TF label="Note" value={nInc.note} onChange={v=>setNInc(n=>({...n,note:v}))}
                      type="text" placeholder="Optional" dark={dark}/>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <TF label="Amount" value={nInc.amount} onChange={v=>setNInc(n=>({...n,amount:v}))}
                      min={0} placeholder="0.00" dark={dark} cls="col-span-2"/>
                    <DD label="Currency" value={nInc.currency} onChange={v=>setNInc(n=>({...n,currency:v}))}
                      opts={CURRENCIES.map(c=>({v:c.code,l:c.code}))} dark={dark}/>
                  </div>
                  {nInc.currency!==dispCur && +nInc.amount>0 && (
                    <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                      ≈ {f2(cx(+nInc.amount,nInc.currency,dispCur),S)} {dispCur}
                    </p>
                  )}
                  <button onClick={addInc}
                    className="w-full py-2.5 rounded-xl text-sm font-black uppercase tracking-wider bg-green-600 hover:bg-green-500 text-white transition-all">
                    ✓ Add Income Entry
                  </button>
                </div>
              </div>
            </div>

            {/* INCOME LIST */}
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t={`📋 Income — ${MOS[selM]} ${selY}`} />

              {/* Salary row */}
              <div className={`rounded-xl p-3 mb-3 border flex items-center justify-between
                ${dark?"border-amber-700/30 bg-amber-950/20":"border-amber-100 bg-amber-50"}`}>
                <div>
                  <p className={`text-xs font-bold ${dark?"text-amber-300":"text-amber-700"}`}>💼 Salary (Day {salDay})</p>
                  <p className={`text-sm font-mono font-bold ${dark?"text-white":"text-slate-800"}`}>
                    {f2(salAmt,cSym(salCur))} {salCur}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>= {dispCur}</p>
                  <p className={`text-base font-black font-mono ${dark?"text-green-400":"text-green-600"}`}>{f2(salDC,S)}</p>
                </div>
              </div>

              {mIncs.length===0
                ? <p className={`text-sm text-center py-8 ${dark?"text-slate-600":"text-slate-300"}`}>No additional income this month.</p>
                : <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {byDate(mIncs).map(it=>(
                      <div key={it.id} className={`rounded-xl p-3 border ${dark?"bg-slate-800 border-slate-700":"bg-slate-50 border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex gap-2 flex-wrap items-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${dark?"bg-green-900/50 text-green-300":"bg-green-100 text-green-700"}`}>{it.type}</span>
                              <span className={`text-xs font-mono ${dark?"text-slate-500":"text-slate-400"}`}>{it.date}</span>
                            </div>
                            <p className={`text-sm font-bold mt-1 truncate ${dark?"text-white":"text-slate-800"}`}>{it.label}</p>
                            {it.note&&<p className={`text-xs italic ${dark?"text-slate-500":"text-slate-400"}`}>{it.note}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-bold font-mono ${dark?"text-green-400":"text-green-600"}`}>{f2(it.amount,cSym(it.currency))} {it.currency}</p>
                            {it.currency!==dispCur&&<p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>= {f2(cx(it.amount,it.currency,dispCur),S)} {dispCur}</p>}
                            <button onClick={()=>delInc(it.id)} className="text-red-400 hover:text-red-300 text-xs mt-1 block">✕ Remove</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              }

              <div className={`mt-3 pt-3 border-t flex justify-between ${dark?"border-slate-700":"border-slate-100"}`}>
                <span className={`text-xs font-bold uppercase ${dark?"text-slate-400":"text-slate-500"}`}>Month Total</span>
                <span className={`text-base font-black font-mono ${dark?"text-green-400":"text-green-600"}`}>{f2(totalInDC,S)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── EXPENSES ──────────────────────────────────────────────────────── */}
        {sec==="expense" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* ADD EXPENSE */}
            <div className={`rounded-2xl border p-5 space-y-3 ${crd}`}>
              <Hdr t="➕ Add Expense" />
              <div className="grid grid-cols-2 gap-3">
                <TF label="Date" value={nExp.date} onChange={v=>setNExp(n=>({...n,date:v}))} type="date" dark={dark}/>
                <div className="flex flex-col gap-1">
                  <label className={`text-xs font-semibold uppercase tracking-widest ${dark?"text-amber-400":"text-slate-500"}`}>Category</label>
                  <select value={nExp.category} onChange={e=>setNExp(n=>({...n,category:e.target.value}))}
                    className={`w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none focus:ring-2
                      ${dark?"bg-slate-800 border-slate-600 text-white focus:ring-amber-500":"bg-white border-slate-200 text-slate-800 focus:ring-blue-400"}`}>
                    {EXP_CATS.map(c=><option key={c}>{c}</option>)}
                    <option value="Custom">✏️ Custom…</option>
                  </select>
                </div>
              </div>
              {nExp.category==="Custom"&&(
                <TF label="Custom Category" value={nExp.customCat} onChange={v=>setNExp(n=>({...n,customCat:v}))}
                  type="text" placeholder="e.g. Chitty / Chit Fund" dark={dark}/>
              )}
              <div className="grid grid-cols-2 gap-3">
                <TF label="Description" value={nExp.label} onChange={v=>setNExp(n=>({...n,label:v}))}
                  type="text" placeholder="e.g. DEWA bill" dark={dark}/>
                <TF label="Note" value={nExp.note} onChange={v=>setNExp(n=>({...n,note:v}))}
                  type="text" placeholder="Optional" dark={dark}/>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TF label="Amount" value={nExp.amount} onChange={v=>setNExp(n=>({...n,amount:v}))}
                  min={0} placeholder="0.00" dark={dark} cls="col-span-2"/>
                <DD label="Currency" value={nExp.currency} onChange={v=>setNExp(n=>({...n,currency:v}))}
                  opts={CURRENCIES.map(c=>({v:c.code,l:c.code}))} dark={dark}/>
              </div>
              {nExp.currency!==dispCur && +nExp.amount>0 && (
                <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                  ≈ {f2(cx(+nExp.amount,nExp.currency,dispCur),S)} {dispCur}
                </p>
              )}
              <button onClick={addExp}
                className="w-full py-2.5 rounded-xl text-sm font-black uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-all">
                ✓ Add Expense Entry
              </button>
            </div>

            {/* EXPENSE LIST */}
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t={`📋 Expenses — ${MOS[selM]} ${selY}`} />
              {mExps.length===0
                ? <p className={`text-sm text-center py-10 ${dark?"text-slate-600":"text-slate-300"}`}>No expense entries this month.</p>
                : <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {byDate(mExps).map((e,i)=>(
                      <div key={e.id} className={`rounded-xl p-3 border ${dark?"bg-slate-800 border-slate-700":"bg-slate-50 border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex gap-2 flex-wrap items-center">
                              <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                                style={{background:PIE_PAL[i%PIE_PAL.length]+"28",color:PIE_PAL[i%PIE_PAL.length]}}>
                                {e.category}
                              </span>
                              <span className={`text-xs font-mono ${dark?"text-slate-500":"text-slate-400"}`}>{e.date}</span>
                            </div>
                            <p className={`text-sm font-bold mt-1 truncate ${dark?"text-white":"text-slate-800"}`}>{e.label}</p>
                            {e.note&&<p className={`text-xs italic ${dark?"text-slate-500":"text-slate-400"}`}>{e.note}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-bold font-mono ${dark?"text-red-400":"text-red-500"}`}>{f2(e.amount,cSym(e.currency))} {e.currency}</p>
                            {e.currency!==dispCur&&<p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>= {f2(cx(e.amount,e.currency,dispCur),S)} {dispCur}</p>}
                            <button onClick={()=>delExp(e.id)} className="text-red-400 hover:text-red-300 text-xs mt-1 block">✕ Remove</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              }
              <div className={`mt-3 pt-3 border-t flex justify-between ${dark?"border-slate-700":"border-slate-100"}`}>
                <span className={`text-xs font-bold uppercase ${dark?"text-slate-400":"text-slate-500"}`}>Month Total</span>
                <span className={`text-base font-black font-mono ${dark?"text-red-400":"text-red-500"}`}>{f2(expsDC,S)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── SAVINGS ───────────────────────────────────────────────────────── */}
        {sec==="savings" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t={`🏦 Savings — ${MOS[selM]} ${selY}`} />

              {/* Auto-computed summary */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className={`rounded-xl p-3 border text-center ${dark?"border-green-700/40 bg-green-900/20":"border-green-200 bg-green-50"}`}>
                  <p className={`text-xs mb-1 ${dark?"text-green-400":"text-green-600"}`}>Income</p>
                  <p className={`text-sm font-black font-mono ${dark?"text-green-300":"text-green-700"}`}>{fK(totalInDC,S)}</p>
                </div>
                <div className={`rounded-xl p-3 border text-center ${dark?"border-red-700/40 bg-red-900/20":"border-red-100 bg-red-50"}`}>
                  <p className={`text-xs mb-1 ${dark?"text-red-400":"text-red-500"}`}>Expenses</p>
                  <p className={`text-sm font-black font-mono ${dark?"text-red-300":"text-red-600"}`}>{fK(expsDC,S)}</p>
                </div>
                <div className={`rounded-xl p-3 border text-center ${netDC>=0?(dark?"border-blue-700/40 bg-blue-900/20":"border-blue-100 bg-blue-50"):(dark?"border-red-700/40 bg-red-900/20":"border-red-100 bg-red-50")}`}>
                  <p className={`text-xs mb-1 ${dark?"text-blue-400":"text-blue-500"}`}>Net</p>
                  <p className={`text-sm font-black font-mono ${netDC>=0?(dark?"text-blue-300":"text-blue-700"):(dark?"text-red-300":"text-red-600")}`}>{fK(netDC,S)}</p>
                </div>
              </div>

              {/* Savings input */}
              <div className={`rounded-xl p-4 border ${dark?"border-slate-700 bg-slate-800/50":"border-slate-100 bg-slate-50"}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-xs font-black uppercase tracking-wider ${dark?"text-slate-300":"text-slate-600"}`}>
                    💰 Amount Saved This Month
                  </p>
                  {savRec.customEdited && (
                    <button onClick={resetSav}
                      className={`text-xs px-2 py-1 rounded-lg border ${dark?"border-slate-600 text-slate-400 hover:text-amber-400":"border-slate-200 text-slate-400 hover:text-blue-500"}`}>
                      ↺ Reset to Auto
                    </button>
                  )}
                </div>

                {savEdit ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <TF label="Saved Amount" value={savInput} onChange={setSavInput}
                        min={0} placeholder="0.00" dark={dark} cls="col-span-2"/>
                      <DD label="Currency" value={savInputCur} onChange={setSavInputCur}
                        opts={CURRENCIES.map(c=>({v:c.code,l:c.code}))} dark={dark}/>
                    </div>
                    {savInputCur!==dispCur && +savInput>0 && (
                      <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                        ≈ {f2(cx(+savInput,savInputCur,dispCur),S)} {dispCur}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={saveSav}
                        className="flex-1 py-2 rounded-xl text-xs font-black uppercase bg-green-600 hover:bg-green-500 text-white transition-all">
                        ✓ Save
                      </button>
                      <button onClick={cancelSav}
                        className={`flex-1 py-2 rounded-xl text-xs font-black uppercase border transition-all ${dark?"border-slate-600 text-slate-300 hover:bg-slate-700":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-xl p-4 border flex items-center justify-between
                    ${dark?"border-green-700/40 bg-green-900/20":"border-green-200 bg-green-50"}`}>
                    <div>
                      <p className={`text-2xl font-black font-mono ${dark?"text-green-300":"text-green-700"}`}>
                        {f2(dispSavedDC,S)}
                      </p>
                      <p className={`text-xs mt-1 ${dark?"text-green-500":"text-green-600"}`}>
                        {savRec.customEdited
                          ? `Custom value — originally entered as ${f2(savRec.savedAmt,cSym(savRec.savedCur))} ${savRec.savedCur}`
                          : `Auto-calculated: income − expenses = ${f2(netDC,S)}`}
                      </p>
                    </div>
                    <button onClick={startEditSav}
                      className={`px-4 py-2 rounded-xl text-xs font-black border transition-all
                        ${dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10":"border-blue-200 text-blue-600 hover:bg-blue-50"}`}>
                      ✏️ Edit
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Savings history mini */}
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t="📆 Savings History" />
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {dashRows.slice().reverse().map(r=>(
                  <button key={r.k} onClick={()=>{const[y,m]=r.k.split("-");setSelY(+y);setSelM(+m-1);setSec("savings");}}
                    className={`w-full rounded-xl p-3 border flex items-center justify-between transition-all hover:scale-[1.01]
                      ${r.k===curMK
                        ? dark?"border-amber-500/50 bg-amber-500/10":"border-blue-300 bg-blue-50"
                        : dark?"border-slate-700 bg-slate-800 hover:border-slate-600":"border-slate-100 bg-slate-50 hover:border-slate-200"}`}>
                    <div className="text-left">
                      <p className={`text-sm font-bold ${dark?"text-white":"text-slate-800"}`}>{r.label}</p>
                      <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                        Inc {fK(r.inc,S)} · Exp {fK(r.exp,S)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-black font-mono ${r.saved>0?(dark?"text-green-400":"text-green-600"):(dark?"text-slate-500":"text-slate-400")}`}>
                        {r.saved>0?fK(r.saved,S):"—"}
                      </p>
                      {r.hasSav&&<span className={`text-xs ${dark?"text-amber-400":"text-amber-600"}`}>✏️ edited</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── PETTY CASH ────────────────────────────────────────────────────── */}
        {sec==="petty" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t={`🪙 Petty Cash — ${MOS[selM]} ${selY}`} />

              <div className={`rounded-xl p-4 mb-4 border ${dark?"border-amber-700/30 bg-amber-950/20":"border-amber-100 bg-amber-50"}`}>
                <p className={`text-xs font-black uppercase tracking-wider mb-1 ${dark?"text-amber-400":"text-amber-600"}`}>Default monthly petty budget</p>
                <div className="flex gap-3 items-end">
                  <TF label="" value={pettyDef} onChange={v=>setPettyDef(+v)} min={0} step={50} dark={dark} sfx={S} cls="flex-1"/>
                  <p className={`text-xs pb-2 ${dark?"text-slate-500":"text-slate-400"}`}>applies to new months</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <TF label={`This Month's Budget (${S})`} value={pettyBudDC}
                  onChange={v=>updPetty({pettyBudget:+v})} min={0} step={50} dark={dark}/>
                <TF label={`Spent So Far (${S})`} value={pettySpentDC}
                  onChange={v=>updPetty({pettySpent:+v})} min={0} step={10} dark={dark}/>
              </div>

              {/* Progress bar */}
              <div className={`rounded-full h-4 overflow-hidden mb-2 ${dark?"bg-slate-700":"bg-slate-200"}`}>
                <div className={`h-4 rounded-full transition-all ${pettyPct>90?"bg-red-500":pettyPct>60?"bg-amber-400":"bg-green-500"}`}
                  style={{width:`${pettyPct}%`}}/>
              </div>
              <div className="flex justify-between text-xs mb-1">
                <span className={dark?"text-slate-400":"text-slate-500"}>Spent: {f2(pettySpentDC,S)} ({pettyPct}%)</span>
                <span className={pettyLeftDC>=0?(dark?"text-green-400":"text-green-600"):(dark?"text-red-400":"text-red-500")}>
                  {pettyLeftDC>=0?"Remaining":"Overspent"}: {f2(Math.abs(pettyLeftDC),S)}
                </span>
              </div>
              {pettyPct>90&&<p className={`text-xs font-bold mt-2 ${dark?"text-red-400":"text-red-500"}`}>⚠️ Over 90% of petty cash used this month!</p>}
            </div>

            {/* Petty history */}
            <div className={`rounded-2xl border p-5 ${crd}`}>
              <Hdr t="📅 Petty Cash History" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allMKs.slice(-12).map(k=>{
                  const r=savMap[k]; const bud=r?.pettyBudget??pettyDef; const sp=r?.pettySpent??0;
                  const pct=bud>0?Math.min(100,Math.round(sp/bud*100)):0;
                  const [y,m]=k.split("-");
                  return (
                    <button key={k} onClick={()=>{setSelY(+y);setSelM(+m-1);setSec("petty");}}
                      className={`rounded-xl p-3 border text-left transition-all hover:scale-[1.02]
                        ${k===curMK
                          ? dark?"border-amber-500/50 bg-amber-500/10":"border-blue-300 bg-blue-50"
                          : dark?"border-slate-700 bg-slate-800":"border-slate-100 bg-white"}`}>
                      <p className={`text-xs font-bold mb-1 ${dark?"text-slate-300":"text-slate-600"}`}>{MOS[+m-1]} {y}</p>
                      <div className={`rounded-full h-2 mb-1 ${dark?"bg-slate-700":"bg-slate-200"}`}>
                        <div className={`h-2 rounded-full ${pct>90?"bg-red-500":pct>60?"bg-amber-400":"bg-green-500"}`} style={{width:`${pct}%`}}/>
                      </div>
                      <p className={`text-xs font-mono ${dark?"text-slate-300":"text-slate-700"}`}>{f2(sp,S)}</p>
                      <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>/ {f2(bud,S)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </>)}

      {/* ══════════════════════════════════════════════════════════════════════════
          DASHBOARD VIEW
      ══════════════════════════════════════════════════════════════════════════ */}
      {view==="dash" && (<>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPI label="Months Saved" value={savedMonths} icon="📅" dark={dark}
            clr={dark?"text-amber-400":"text-amber-600"}
            sub={`of ${allMKs.length} months tracked`}/>
          <KPI label="Total Saved" value={fK(totalSaved,S)} icon="🏦" dark={dark}
            clr={dark?"text-green-400":"text-green-600"}/>
          <KPI label="Avg / Month" value={fK(avgSaved,S)} icon="📈" dark={dark}
            clr={dark?"text-blue-400":"text-blue-600"}
            sub="saved months only"/>
          <KPI label="This Month Net" value={f2(netDC,S)} icon="⚖️" dark={dark}
            clr={netDC>=0?(dark?"text-green-400":"text-green-600"):(dark?"text-red-400":"text-red-500")}
            sub={`${MOS[selM]} ${selY}`}/>
        </div>

        {/* Savings calendar */}
        <div className={`rounded-2xl border p-5 ${crd}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-sm font-black uppercase tracking-widest ${dark?"text-amber-400":"text-blue-600"}`}>📆 Savings Calendar</h3>
            <span className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>Click any month to view / edit</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-13 gap-2">
            {allMKs.map(k=>{
              const r=dashRows.find(d=>d.k===k);
              const saved=r&&r.saved>0;
              const[y,m]=k.split("-");
              return (
                <button key={k} onClick={()=>{setSelY(+y);setSelM(+m-1);setView("entry");setSec("savings");}}
                  className={`rounded-xl p-2 text-center border transition-all hover:scale-105
                    ${saved
                      ? dark?"bg-green-700/40 border-green-600/40":"bg-green-100 border-green-300"
                      : dark?"bg-slate-800 border-slate-700 opacity-60":"bg-slate-50 border-slate-200 opacity-60"}`}>
                  <p className={`text-xs font-bold ${saved?(dark?"text-green-300":"text-green-700"):dark?"text-slate-400":"text-slate-500"}`}>{MOS[+m-1]}</p>
                  <p className={`text-xs font-mono ${saved?(dark?"text-green-400":"text-green-600"):dark?"text-slate-600":"text-slate-400"}`}>
                    {saved?fK(r.saved,S):"·"}
                  </p>
                </button>
              );
            })}
          </div>
          <p className={`text-xs mt-3 ${dark?"text-slate-600":"text-slate-400"}`}>🟢 Green = savings recorded</p>
        </div>

        {/* Income vs Expenses trend */}
        <div className={`rounded-2xl border p-5 ${crd}`}>
          <h3 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>📊 Income vs Expenses (last 12 months)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dashRows.slice(-12)} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark?"#334155":"#e2e8f0"}/>
              <XAxis dataKey="label" tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}}/>
              <YAxis tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} tickFormatter={v=>`${S}${(v/1000).toFixed(0)}K`}/>
              <Tooltip content={<CTip dark={dark} sym={S}/>}/>
              <Legend/>
              <Bar dataKey="inc"   name="Income"   fill={dark?"#34d399":"#059669"} radius={[3,3,0,0]}/>
              <Bar dataKey="exp"   name="Expenses" fill={dark?"#f87171":"#ef4444"} radius={[3,3,0,0]}/>
              <Bar dataKey="saved" name="Saved"    fill={dark?"#f59e0b":"#2563eb"} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Expense pie + savings table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Pie */}
          <div className={`rounded-2xl border p-5 ${crd}`}>
            <h3 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>
              🥧 Expense Breakdown — {MOS[selM]} {selY}
            </h3>
            {expPie.length===0
              ? <p className={`text-sm text-center py-10 ${dark?"text-slate-600":"text-slate-300"}`}>No expenses for this month.</p>
              : <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={expPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                        label={({name,percent})=>`${(percent*100).toFixed(0)}%`} labelLine={false}>
                        {expPie.map((_,i)=><Cell key={i} fill={PIE_PAL[i%PIE_PAL.length]}/>)}
                      </Pie>
                      <Tooltip formatter={(v)=>`${S}${f2(v,"")}`}/>
                      <Legend iconSize={10} formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-3">
                    {expPie.map((e,i)=>(
                      <div key={e.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{background:PIE_PAL[i%PIE_PAL.length]}}/>
                          <span className={dark?"text-slate-300":"text-slate-700"}>{e.name}</span>
                        </div>
                        <span className={`font-mono font-bold ${dark?"text-white":"text-slate-800"}`}>{f2(e.value,S)}</span>
                      </div>
                    ))}
                  </div>
                </>
            }
          </div>

          {/* Savings table */}
          <div className={`rounded-2xl border p-5 ${crd}`}>
            <h3 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>💰 Monthly Savings Summary</h3>
            <div className="overflow-auto" style={{maxHeight:380}}>
              <table className="w-full text-xs font-mono">
                <thead className={`sticky top-0 ${dark?"bg-slate-800 text-amber-400":"bg-slate-50 text-blue-700"}`}>
                  <tr>
                    {["Month","Income","Expenses","Net","Saved"].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dashRows.slice().reverse().map((r,i)=>(
                    <tr key={r.k} onClick={()=>{const[y,m]=r.k.split("-");setSelY(+y);setSelM(+m-1);setView("entry");setSec("savings");}}
                      className={`border-t cursor-pointer transition-colors
                        ${i%2===0?(dark?"bg-slate-900 border-slate-800 hover:bg-slate-800":"bg-white border-slate-50 hover:bg-slate-50")
                                 :(dark?"bg-slate-900/60 border-slate-800 hover:bg-slate-800":"bg-slate-50/60 border-slate-100 hover:bg-slate-50")}`}>
                      <td className={`px-3 py-2 font-bold ${dark?"text-slate-300":"text-slate-700"}`}>{r.label}</td>
                      <td className={`px-3 py-2 ${dark?"text-green-400":"text-green-600"}`}>{fK(r.inc,S)}</td>
                      <td className={`px-3 py-2 ${dark?"text-red-400":"text-red-500"}`}>{fK(r.exp,S)}</td>
                      <td className={`px-3 py-2 ${r.net>=0?(dark?"text-blue-400":"text-blue-600"):(dark?"text-red-400":"text-red-500")}`}>{fK(r.net,S)}</td>
                      <td className={`px-3 py-2 font-bold ${r.saved>0?(dark?"text-amber-400":"text-amber-600"):dark?"text-slate-600":"text-slate-300"}`}>
                        {r.saved>0?fK(r.saved,S):"—"}
                        {r.hasSav&&<span className="ml-1 opacity-60">✏️</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Net balance trend line */}
        <div className={`rounded-2xl border p-5 ${crd}`}>
          <h3 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>📈 Net Balance Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dashRows.slice(-12)}>
              <defs>
                <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={dark?"#38bdf8":"#2563eb"} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={dark?"#38bdf8":"#2563eb"} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={dark?"#334155":"#e2e8f0"}/>
              <XAxis dataKey="label" tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}}/>
              <YAxis tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} tickFormatter={v=>`${S}${(v/1000).toFixed(0)}K`}/>
              <Tooltip content={<CTip dark={dark} sym={S}/>}/>
              <Area type="monotone" dataKey="net" name="Net Balance" stroke={dark?"#38bdf8":"#2563eb"} fill="url(#gN)" strokeWidth={2.5}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  LOAN PLANNER TAB
// ════════════════════════════════════════════════════════════════════════════════
function LoanTab({dark, baseCurrency, user}) {
  const S   = baseCurrency.sym;
  const [P,  setP]   = useState(()=>+(uGet(user,"loan_p",500000)));
  const [R,  setR]   = useState(()=>+(uGet(user,"loan_r",8.5)));
  const [N,  setN]   = useState(()=>+(uGet(user,"loan_n",240)));
  const [sd, setSd]  = useState(()=>uGet(user,"loan_sd",""));
  const [dE, setDE]  = useState(()=>!!uGet(user,"loan_de",false));
  const [dM, setDM]  = useState(()=>+(uGet(user,"loan_dm",3)));
  const [pps,setPPs] = useState(()=>uGet(user,"loan_pps",[{id:1,mode:"once",ym:"",month:12,amount:50000,type:"tenure",startYm:"",endYm:"",interval:3}]));
  const [res,setRes] = useState(null);
  const [dirty,setDirty] = useState(true);
  const [pulse,setPulse] = useState(false);
  const [tab,  setTab]   = useState("charts");

  // persist loan inputs per user
  useEffect(()=>uSet(user,"loan_p",P),[P,user]);
  useEffect(()=>uSet(user,"loan_r",R),[R,user]);
  useEffect(()=>uSet(user,"loan_n",N),[N,user]);
  useEffect(()=>uSet(user,"loan_sd",sd),[sd,user]);
  useEffect(()=>uSet(user,"loan_de",dE),[dE,user]);
  useEffect(()=>uSet(user,"loan_dm",dM),[dM,user]);
  useEffect(()=>uSet(user,"loan_pps",pps),[pps,user]);

  // Restore last calculated result on mount / user change by recomputing from saved snapshot
  useEffect(()=>{
    const snap = uGet(user,"loan_snap",null);
    if (!snap) return;
    try {
      const dm2 = snap.dE ? Math.max(0,+snap.dM) : 0;
      const sched = buildSched(+snap.P,+snap.R,+snap.N,
        (snap.pps||[]).filter(p=>+p.amount>0), snap.sd||null, dm2);
      const base = buildSched(+snap.P,+snap.R,+snap.N,[],snap.sd||null,0);
      setRes({sched,base,saved:base.tInt-sched.tInt,mSaved:base.totalM-sched.totalM});
      const same = +snap.P===+P && +snap.R===+R && +snap.N===+N &&
        (snap.sd||"")===(sd||"") && !!snap.dE===!!dE && +snap.dM===+dM &&
        JSON.stringify(snap.pps)===JSON.stringify(pps);
      setDirty(!same);
    } catch(_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user]);

  useEffect(()=>setDirty(true),[P,R,N,sd,dE,dM,pps]);

  const calc = () => {
    setPulse(true); setTimeout(()=>setPulse(false),500);
    const dm = dE ? Math.max(0,+dM) : 0;
    const sched = buildSched(+P,+R,+N,pps.filter(p=>+p.amount>0),sd||null,dm);
    const base  = buildSched(+P,+R,+N,[],sd||null,0);
    setRes({sched,base,saved:base.tInt-sched.tInt,mSaved:base.totalM-sched.totalM});
    uSet(user,"loan_snap",{P,R,N,sd:sd||"",dE,dM,pps});
    setDirty(false);
  };

  const addPP  = ()       => setPPs(p=>[...p,{id:Date.now(),mode:"once",ym:"",month:0,amount:0,type:"tenure",startYm:"",endYm:"",interval:3}]);
  const delPP  = id       => setPPs(p=>p.filter(x=>x.id!==id));
  const updPP  = (id,k,v) => setPPs(p=>p.map(x=>x.id===id?{...x,[k]:v}:x));

  const dlCSV = () => {
    if(!res) return;
    const h=["Month","Date","Phase","Opening","Interest","EMI","Principal","Prepay","Closing","Note"];
    const d=res.sched.rows.map(r=>[r.month,r.date,r.phase,r.opening.toFixed(2),r.interest.toFixed(2),
      r.emi.toFixed(2),r.principal.toFixed(2),r.prepay.toFixed(2),r.closing.toFixed(2),`"${r.note||""}"`]);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([[h,...d].map(r=>r.join(",")).join("\n")],{type:"text/csv"}));
    a.download="loan.csv"; a.click();
  };

  const bCData = useMemo(()=>{
    if(!res) return [];
    const step=Math.max(1,Math.floor(res.sched.rows.length/60));
    return res.sched.rows.filter((_,i)=>i%step===0||i===res.sched.rows.length-1).map(r=>({
      name:r.date,"Optimised":Math.round(r.closing),"Original":Math.round(res.base.rows[r.month-1]?.closing??0)
    }));
  },[res]);

  const yrData = useMemo(()=>{
    if(!res) return [];
    const y={};
    res.sched.rows.forEach(r=>{const k=`Y${Math.ceil(r.month/12)}`;if(!y[k])y[k]={y:k,int:0,prin:0};y[k].int+=r.interest;y[k].prin+=r.principal;});
    return Object.values(y);
  },[res]);

  const cmpData = useMemo(()=>{
    if(!res) return [];
    const mx=Math.max(res.sched.rows.length,res.base.rows.length);
    const step=Math.max(1,Math.floor(mx/60));
    const out=[];
    for(let i=0;i<mx;i+=step){
      const o=res.base.rows[i],s=res.sched.rows[i];
      if(!o&&!s) continue;
      out.push({name:o?.date||s?.date,Original:Math.round(o?.closing??0),Optimised:Math.round(s?.closing??0)});
    }
    return out;
  },[res]);

  const crd  = dark?"bg-slate-900 border-slate-800":"bg-white border-slate-100 shadow-sm";
  const tOn  = dark?"bg-amber-500 text-slate-900 font-black":"bg-blue-600 text-white font-black";
  const tOff = dark?"text-slate-400 hover:text-amber-300":"text-slate-500 hover:text-blue-600";
  const inp  = dark?"bg-slate-800 border-slate-600 text-white focus:ring-amber-500":"bg-white border-slate-200 text-slate-800 focus:ring-blue-400";
  const C    = dark?{p:"#f59e0b",s:"#38bdf8",g:"#34d399",m:"#6b7280"}:{p:"#2563eb",s:"#0891b2",g:"#059669",m:"#9ca3af"};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Loan inputs */}
        <div className={`rounded-2xl border p-6 space-y-4 ${crd}`}>
          <h2 className={`text-sm font-black uppercase tracking-widest ${dark?"text-amber-400":"text-blue-600"}`}>📋 Loan Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <TF label="Outstanding Principal" value={P} onChange={setP} min={0} step={1000} dark={dark} sfx={S}/>
            </div>
            <TF label="Annual Interest Rate" value={R} onChange={setR} min={0} step={0.1} dark={dark} sfx="%"/>
            <TF label="Remaining Tenure" value={N} onChange={setN} min={1} step={1} dark={dark} sfx="mo"/>
            <div className="col-span-2">
              <label className={`text-xs font-semibold uppercase tracking-widest block mb-1 ${dark?"text-amber-400":"text-slate-500"}`}>Start Date (optional)</label>
              <input type="month" value={sd} onChange={e=>setSd(e.target.value)}
                className={`w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none focus:ring-2 ${inp}`}/>
            </div>
          </div>
          {/* Deferment */}
          <div className={`rounded-xl border overflow-hidden ${dark?"border-purple-700/40 bg-purple-950/20":"border-purple-200 bg-purple-50"}`}>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span>⏸️</span>
                <div>
                  <p className={`text-xs font-black uppercase ${dark?"text-purple-300":"text-purple-700"}`}>Deferment / Moratorium</p>
                  <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>Interest accrues, no EMI paid</p>
                </div>
              </div>
              <button onClick={()=>setDE(v=>!v)}
                className={`text-xs px-3 py-1.5 rounded-full font-black ${dE?dark?"bg-purple-500 text-white":"bg-purple-600 text-white":dark?"bg-slate-700 text-slate-400":"bg-slate-200 text-slate-500"}`}>
                {dE?"ON":"OFF"}
              </button>
            </div>
            {dE&&(
              <div className={`px-4 pb-4 pt-2 border-t space-y-2 ${dark?"border-purple-700/40":"border-purple-200"}`}>
                <TF label="Deferment Months" value={dM} onChange={setDM} min={1} max={60} dark={dark} sfx="mo"/>
                <p className={`text-xs ${dark?"text-purple-400":"text-purple-600"}`}>
                  During months 1–{dM}: no EMI. Interest is capitalised (added to principal). EMI recalculated after.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Prepayments + Calculate */}
        <div className={`rounded-2xl border p-6 flex flex-col ${crd}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-sm font-black uppercase tracking-widest ${dark?"text-amber-400":"text-blue-600"}`}>💰 Prepayments</h2>
            <button onClick={addPP}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10":"border-blue-200 text-blue-600 hover:bg-blue-50"}`}>
              + Add
            </button>
          </div>
          {!sd&&(
            <div className={`rounded-lg px-3 py-2 text-xs mb-3 ${dark?"bg-amber-900/30 text-amber-300 border border-amber-700/30":"bg-amber-50 text-amber-700 border border-amber-200"}`}>
              💡 Set a <strong>Start Date</strong> in Loan Details to use month/year pickers
            </div>
          )}
          <div className="space-y-3 flex-1 overflow-y-auto max-h-96 pr-1">
            {pps.length===0&&<p className={`text-sm text-center py-8 ${dark?"text-slate-600":"text-slate-400"}`}>No prepayments added.</p>}
            {pps.map((pp,i)=>{
              const modeOpts=[{v:"once",l:"📌 One-time"},{v:"monthly",l:"🔁 Every Month"},{v:"interval",l:"📆 Every N Months"}];
              return (
              <div key={pp.id} className={`rounded-xl p-3 border ${dark?"bg-slate-800 border-slate-700":"bg-slate-50 border-slate-200"}`}>
                {/* Header */}
                <div className="flex justify-between items-center mb-3">
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${dark?"bg-amber-500/20 text-amber-400":"bg-blue-50 text-blue-600"}`}>#{i+1}</span>
                  <button onClick={()=>delPP(pp.id)} className={`text-xs px-2 py-1 rounded-lg ${dark?"text-red-400 hover:bg-red-900/30":"text-red-500 hover:bg-red-50"}`}>✕ Remove</button>
                </div>

                {/* Mode selector */}
                <div className="mb-3">
                  <label className={`text-xs block mb-1 font-semibold ${dark?"text-slate-400":"text-slate-500"}`}>Type</label>
                  <div className="flex gap-1 flex-wrap">
                    {modeOpts.map(m=>(
                      <button key={m.v} onClick={()=>updPP(pp.id,"mode",m.v)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg font-bold border transition-all ${pp.mode===m.v
                          ? dark?"bg-amber-500 text-slate-900 border-amber-500":"bg-blue-600 text-white border-blue-600"
                          : dark?"border-slate-600 text-slate-400 hover:border-amber-500/50":"border-slate-200 text-slate-500 hover:border-blue-300"}`}>
                        {m.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ONE-TIME fields */}
                {pp.mode==="once"&&(
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Month & Year</label>
                      <input type="month" value={pp.ym||""} onChange={e=>updPP(pp.id,"ym",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                      {!sd&&<span className={`text-xs ${dark?"text-slate-600":"text-slate-400"}`}>Set start date above for month picker</span>}
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Amount ({S})</label>
                      <input type="number" value={pp.amount||""} min={0} onChange={e=>updPP(pp.id,"amount",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Strategy</label>
                      <select value={pp.type||"tenure"} onChange={e=>updPP(pp.id,"type",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none ${inp}`}>
                        <option value="tenure">↓ Tenure</option>
                        <option value="emi">↓ EMI</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* MONTHLY fields */}
                {pp.mode==="monthly"&&(
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>From Month</label>
                      <input type="month" value={pp.startYm||""} onChange={e=>updPP(pp.id,"startYm",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Until Month <span className={dark?"text-slate-600":"text-slate-300"}>(optional)</span></label>
                      <input type="month" value={pp.endYm||""} onChange={e=>updPP(pp.id,"endYm",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Amount / Month ({S})</label>
                      <input type="number" value={pp.amount||""} min={0} onChange={e=>updPP(pp.id,"amount",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Strategy</label>
                      <select value={pp.type||"tenure"} onChange={e=>updPP(pp.id,"type",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none ${inp}`}>
                        <option value="tenure">↓ Tenure</option>
                        <option value="emi">↓ EMI</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* INTERVAL fields */}
                {pp.mode==="interval"&&(
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>From Month</label>
                      <input type="month" value={pp.startYm||""} onChange={e=>updPP(pp.id,"startYm",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Until Month <span className={dark?"text-slate-600":"text-slate-300"}>(optional)</span></label>
                      <input type="month" value={pp.endYm||""} onChange={e=>updPP(pp.id,"endYm",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Every N Months</label>
                      <input type="number" value={pp.interval||3} min={1} max={60} onChange={e=>updPP(pp.id,"interval",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Amount ({S})</label>
                      <input type="number" value={pp.amount||""} min={0} onChange={e=>updPP(pp.id,"amount",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none focus:ring-1 ${inp}`}/>
                    </div>
                    <div>
                      <label className={`text-xs block mb-1 ${dark?"text-slate-400":"text-slate-500"}`}>Strategy</label>
                      <select value={pp.type||"tenure"} onChange={e=>updPP(pp.id,"type",e.target.value)}
                        className={`w-full rounded-lg px-2 py-1.5 text-xs font-mono border outline-none ${inp}`}>
                        <option value="tenure">↓ Tenure</option>
                        <option value="emi">↓ EMI</option>
                      </select>
                    </div>
                    <div className={`col-span-2 rounded-lg px-3 py-2 text-xs ${dark?"bg-slate-700 text-slate-400":"bg-slate-100 text-slate-500"}`}>
                      📆 Pays {S}{pp.amount||0} every {pp.interval||3} month(s){pp.startYm?` from ${pp.startYm}`:""}
                      {pp.endYm?` until ${pp.endYm}`:` until loan ends`}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <div className={`mt-5 pt-5 border-t ${dark?"border-slate-700":"border-slate-200"}`}>
            <button onClick={calc}
              className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all duration-200 shadow-lg
                ${pulse?"scale-95 opacity-80":"scale-100"}
                ${dirty
                  ? dark?"bg-amber-500 hover:bg-amber-400 text-slate-900":"bg-blue-600 hover:bg-blue-500 text-white"
                  : dark?"bg-slate-700 text-slate-300":"bg-slate-200 text-slate-500"}`}>
              {pulse?"⚙️ Calculating…":dirty?"⚡ Calculate Plan":"✅ Up-to-Date"}
            </button>
            {dirty&&!pulse&&<p className={`text-center text-xs mt-2 ${dark?"text-slate-500":"text-slate-400"}`}>Inputs changed — press to recalculate</p>}
          </div>
        </div>
      </div>

      {!res&&(
        <div className={`rounded-2xl border p-14 text-center ${crd}`}>
          <p className="text-5xl mb-4">📊</p>
          <p className={`text-sm ${dark?"text-slate-400":"text-slate-500"}`}>Enter loan details and click <strong className={dark?"text-amber-400":"text-blue-600"}>⚡ Calculate Plan</strong></p>
        </div>
      )}

      {res&&(<>
        {/* Deferment banner */}
        {res.sched.defer>0&&(
          <div className={`rounded-2xl border p-5 ${dark?"border-purple-700/40 bg-purple-950/25":"border-purple-200 bg-purple-50"}`}>
            <p className={`text-sm font-black uppercase mb-3 ${dark?"text-purple-300":"text-purple-700"}`}>⏸️ Deferment — {res.sched.defer} months</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[["Period",`${res.sched.defer} months`],["Accrued Interest",f2(res.sched.dInt,S)],
                ["Post-Defer Principal",f2(+P+res.sched.dInt,S)],["New EMI",f2(res.sched.postEMI,S)]].map(([l,v])=>(
                <div key={l} className={`rounded-xl p-3 border ${dark?"bg-purple-900/30 border-purple-800/40":"bg-white border-purple-200"}`}>
                  <p className={`text-xs mb-1 ${dark?"text-purple-400":"text-purple-500"}`}>{l}</p>
                  <p className={`text-sm font-bold font-mono ${dark?"text-purple-200":"text-purple-700"}`}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Insights */}
        <div className={`rounded-2xl border p-5 ${dark?"bg-gradient-to-r from-amber-950/40 to-slate-900 border-amber-800/30":"bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100"}`}>
          <h2 className={`text-sm font-black uppercase tracking-widest mb-4 ${dark?"text-amber-400":"text-blue-600"}`}>🔍 Smart Insights</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPI icon="💸" label="Interest Saved" value={f2(Math.max(0,res.saved),S)} dark={dark}
              clr={dark?"text-amber-400":"text-blue-600"}
              sub={res.saved>0?"vs. no-prepayment schedule":"Add prepayments to save"}/>
            <KPI icon="📅" label="Months Saved" value={`${Math.max(0,res.mSaved)} months`} dark={dark}
              clr={dark?"text-amber-400":"text-blue-600"}
              sub={res.mSaved>0?`Closes ${res.mSaved} months early`:"No change yet"}/>
            <KPI icon="📋" label="Post-Defer EMI" value={f2(res.sched.postEMI,S)} dark={dark}
              sub={res.sched.defer>0?"Recalculated after deferment":"Same as original"}/>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[["Original EMI",f2(emi(+P,+R,+N),S),"📊"],["Total Interest",f2(res.sched.tInt,S),"🏷️"],
            ["Total Duration",`${res.sched.totalM} months`,"⏱️"],["Interest Saved",f2(Math.max(0,res.saved),S),"✅"]].map(([l,v,ic])=>(
            <KPI key={l} label={l} value={v} icon={ic} dark={dark}/>
          ))}
        </div>

        {/* Result tabs */}
        <div className={`rounded-2xl border overflow-hidden ${crd}`}>
          <div className={`flex gap-1 p-2 border-b flex-wrap ${dark?"border-slate-800 bg-slate-900/50":"border-slate-100 bg-slate-50"}`}>
            {[{id:"charts",l:"📈 Charts"},{id:"table",l:"📋 Table"},{id:"cmp",l:"⚡ Compare"}].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                className={`px-4 py-2 text-xs rounded-lg ${tab===t.id?tOn:tOff}`}>{t.l}</button>
            ))}
          </div>
          <div className="p-6">

            {tab==="charts"&&(
              <div className="space-y-10">
                <div>
                  <p className={`text-xs font-black uppercase tracking-widest mb-3 ${dark?"text-slate-400":"text-slate-500"}`}>Principal Balance Over Time</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={bCData}>
                      <defs>
                        <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.p} stopOpacity={.3}/><stop offset="95%" stopColor={C.p} stopOpacity={0}/></linearGradient>
                        <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.m} stopOpacity={.2}/><stop offset="95%" stopColor={C.m} stopOpacity={0}/></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={dark?"#334155":"#e2e8f0"}/>
                      <XAxis dataKey="name" tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                      <YAxis tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} tickFormatter={v=>`${S}${(v/1000).toFixed(0)}K`}/>
                      <Tooltip content={<CTip dark={dark} sym={S}/>}/><Legend/>
                      <Area type="monotone" dataKey="Original"  stroke={C.m} fill="url(#gB)" strokeWidth={1.5} strokeDasharray="4 4"/>
                      <Area type="monotone" dataKey="Optimised" stroke={C.p} fill="url(#gO)" strokeWidth={2.5}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className={`text-xs font-black uppercase tracking-widest mb-3 ${dark?"text-slate-400":"text-slate-500"}`}>Annual Interest vs Principal</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={yrData} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke={dark?"#334155":"#e2e8f0"}/>
                      <XAxis dataKey="y" tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}}/>
                      <YAxis tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} tickFormatter={v=>`${S}${(v/1000).toFixed(0)}K`}/>
                      <Tooltip content={<CTip dark={dark} sym={S}/>}/><Legend/>
                      <Bar dataKey="int"  name="Interest"  fill={dark?"#ef4444":"#f87171"} radius={[3,3,0,0]}/>
                      <Bar dataKey="prin" name="Principal" fill={C.g}                       radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {tab==="table"&&(
              <div>
                <div className="flex justify-between mb-4">
                  <span className={`text-xs ${dark?"text-slate-400":"text-slate-500"}`}>{res.sched.rows.length} rows</span>
                  <button onClick={dlCSV} className={`text-xs px-4 py-2 rounded-lg font-bold border ${dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10":"border-blue-200 text-blue-600 hover:bg-blue-50"}`}>⬇️ CSV</button>
                </div>
                <div className="overflow-x-auto rounded-xl border" style={{maxHeight:460,overflowY:"auto"}}>
                  <table className="w-full text-xs font-mono">
                    <thead className={`sticky top-0 ${dark?"bg-slate-800 text-amber-400":"bg-slate-50 text-blue-700"}`}>
                      <tr>{["#","Date","Phase","Opening","Interest","EMI","Principal","Prepay","Closing","Note"].map(h=>(
                        <th key={h} className="px-3 py-2.5 text-left font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {res.sched.rows.map((r,i)=>{
                        const isD=r.phase==="deferment",hasP=r.prepay>0;
                        const rc=isD?dark?"bg-purple-900/30 border-purple-800/30":"bg-purple-50 border-purple-100"
                          :hasP?dark?"bg-amber-950/30 border-amber-900/30":"bg-amber-50 border-amber-100"
                          :i%2===0?dark?"bg-slate-900 border-slate-800":"bg-white border-slate-50"
                                  :dark?"bg-slate-900/50 border-slate-800":"bg-slate-50/50 border-slate-100";
                        return (
                          <tr key={`${r.phase}-${r.month}`} className={`border-t ${rc}`}>
                            <td className="px-3 py-2 font-bold">{r.month}</td>
                            <td className={`px-3 py-2 ${dark?"text-slate-400":"text-slate-500"}`}>{r.date}</td>
                            <td className="px-3 py-2">{isD?<span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark?"bg-purple-700/50 text-purple-300":"bg-purple-100 text-purple-700"}`}>Defer</span>:"Repay"}</td>
                            <td className="px-3 py-2">{f2(r.opening)}</td>
                            <td className={`px-3 py-2 ${dark?"text-red-400":"text-red-500"}`}>{f2(r.interest)}{isD&&<span className={`ml-1 text-xs ${dark?"text-purple-400":"text-purple-500"}`}>(cap.)</span>}</td>
                            <td className="px-3 py-2">{isD?"—":f2(r.emi)}</td>
                            <td className={`px-3 py-2 ${dark?"text-green-400":"text-green-600"}`}>{isD?<span className={`italic text-xs ${dark?"text-purple-400":"text-purple-500"}`}>+{f2(r.interest)}</span>:f2(r.principal)}</td>
                            <td className={`px-3 py-2 font-bold ${hasP?dark?"text-amber-400":"text-amber-600":dark?"text-slate-600":"text-slate-300"}`}>{hasP?f2(r.prepay):"—"}</td>
                            <td className="px-3 py-2 font-bold">{f2(r.closing)}</td>
                            <td className={`px-3 py-2 italic max-w-xs truncate ${dark?"text-slate-500":"text-slate-400"}`}>{r.note}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab==="cmp"&&(
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[["Original Duration",`${res.base.totalM}mo`],["Optimised Duration",`${res.sched.totalM}mo`],
                    ["Original Interest",f2(res.base.tInt,S)],["Optimised Interest",f2(res.sched.tInt,S)]].map(([l,v])=>(
                    <KPI key={l} label={l} value={v} dark={dark}/>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={cmpData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark?"#334155":"#e2e8f0"}/>
                    <XAxis dataKey="name" tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                    <YAxis tick={{fill:dark?"#94a3b8":"#64748b",fontSize:10}} tickFormatter={v=>`${S}${(v/1000).toFixed(0)}K`}/>
                    <Tooltip content={<CTip dark={dark} sym={S}/>}/><Legend/>
                    <Line type="monotone" dataKey="Original"  stroke={C.m} strokeWidth={2}   dot={false} strokeDasharray="5 5"/>
                    <Line type="monotone" dataKey="Optimised" stroke={C.p} strokeWidth={2.5} dot={false}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  AUTH HELPERS  (all data namespaced per user in localStorage)
// ════════════════════════════════════════════════════════════════════════════════

/** Simple hash — NOT cryptographic, just enough to avoid plain-text passwords */
const hashPw = async (pw) => {
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
};

const AUTH_KEY   = "slfp_users";       // {username:{hash,displayName,createdAt}}
const SESSION_KEY= "slfp_session";     // {username,displayName}
const uKey       = (u,k) => `u_${u}_${k}`;  // per-user storage key

const getUsers   = () => { try{return JSON.parse(localStorage.getItem(AUTH_KEY)||"{}");}catch{return{};} };
const saveUsers  = u  => localStorage.setItem(AUTH_KEY, JSON.stringify(u));
const getSession = () => { try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null");}catch{return null;} };
const saveSession= s  => localStorage.setItem(SESSION_KEY, JSON.stringify(s));
const clearSession=()  => localStorage.removeItem(SESSION_KEY);

/** Read a per-user key */
const uGet = (u,k,fb=null) => { try{const v=localStorage.getItem(uKey(u,k));return v!==null?JSON.parse(v):fb;}catch{return fb;} };
/** Write a per-user key */
const uSet = (u,k,v) => localStorage.setItem(uKey(u,k), JSON.stringify(v));
/** Delete ALL per-user data keys (reset) */
const uReset = (u) => {
  const keys=["f_dc","f_sa","f_sc","f_sd","f_pd","f_incs","f_exps","f_sav",
               "loan_p","loan_r","loan_n","loan_sd","loan_de","loan_dm","loan_pps","loan_snap"];
  keys.forEach(k=>localStorage.removeItem(uKey(u,k)));
};

// ════════════════════════════════════════════════════════════════════════════════
//  GOOGLE DRIVE BACKUP
//  Flow: user clicks Backup → Google OAuth popup (account chooser) →
//        app gets access token + user's email → saves/loads file named
//        finance-planner-{email}.json in THEIR Drive. Zero config needed.
//
//  Requires: Google OAuth Client ID configured for this app's domain.
//  Set once in Google Cloud Console → Credentials → OAuth 2.0 Client ID
//  (Web application, add your GitHub Pages URL as authorised origin).
//  Then paste the Client ID once in the app's Backup settings.
// ════════════════════════════════════════════════════════════════════════════════

const GD_SCOPES   = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const DATA_KEYS   = ["f_dc","f_sa","f_sc","f_sd","f_pd","f_incs","f_exps","f_sav",
                     "loan_p","loan_r","loan_n","loan_sd","loan_de","loan_dm","loan_pps","loan_snap"];

// Filename always tied to the Google email — not the app username
const gdFilename  = (email) => `finance-planner-${email}.json`;

/** Collect all per-user localStorage keys into one object */
const exportData = (username) => ({
  version: 3,
  exportedAt: new Date().toISOString(),
  appUsername: username,
  data: Object.fromEntries(DATA_KEYS.map(k => [k, uGet(username, k, null)]))
});

/** Write imported data back to localStorage */
const importData = (username, payload) => {
  const d = payload.data || payload;
  DATA_KEYS.forEach(k => { if (d[k] != null) uSet(username, k, d[k]); });
};

/** Download a JSON file to the browser */
const dlJSON = (obj, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download = name; a.click();
};

// ── OAuth state ───────────────────────────────────────────────────────────────
let _gdToken     = null;   // short-lived access token
let _gdEmail     = null;   // user's Google email (retrieved after auth)
let _gdClient    = null;   // GIS token client (reused)

/** Sign in with Google and get email + access token.
 *  Resolves to { token, email }.
 *  On subsequent calls reuses cached token silently. */
const gdAuth = () => new Promise((resolve, reject) => {
  const cid = localStorage.getItem("slfp_gd_cid") || "";
  if (!cid) return reject(new Error("NO_CLIENT_ID"));
  if (!window.google?.accounts?.oauth2)
    return reject(new Error("Google Sign-In script not loaded — check your internet and refresh the page."));

  const done = async (accessToken) => {
    _gdToken = accessToken;
    // Fetch the user's email via People API
    try {
      const r = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      const info = await r.json();
      _gdEmail = info.email || null;
    } catch { _gdEmail = null; }
    resolve({ token: accessToken, email: _gdEmail });
  };

  if (_gdClient) {
    // Already initialised — request token (silent if still valid)
    _gdClient.requestAccessToken({ prompt: "" });
    return;
  }

  _gdClient = window.google.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: GD_SCOPES,
    callback: (r) => {
      if (r.error) reject(new Error(r.error_description || r.error));
      else done(r.access_token);
    },
  });
  _gdClient.requestAccessToken({ prompt: "select_account" });
});

/** Low-level Drive/API fetch with Bearer token */
const gdFetch = async (path, opts = {}) => {
  const r = await fetch("https://www.googleapis.com" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + _gdToken, ...(opts.headers || {}) }
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `HTTP ${r.status}`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : {};
};

/** Find backup file in user's Drive — returns file object or null */
const gdFindFile = async (email) => {
  const name = gdFilename(email);
  const q    = encodeURIComponent(`name='${name}' and trashed=false`);
  const res  = await gdFetch(`/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime,size)&pageSize=5`);
  return (res.files || [])[0] || null;
};

/** Upload (create or update) backup to Drive. Returns { action, filename, email } */
const gdSave = async (username) => {
  const { email } = await gdAuth();
  if (!email) throw new Error("Could not retrieve your Google email. Please try again.");
  const filename = gdFilename(email);
  const payload  = { ...exportData(username), googleEmail: email };
  const existing = await gdFindFile(email);
  const blob     = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const meta     = JSON.stringify({ name: filename, mimeType: "application/json" });
  const form     = new FormData();
  form.append("metadata", new Blob([meta], { type: "application/json" }));
  form.append("file", blob);
  const url    = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const method = existing ? "PATCH" : "POST";
  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + _gdToken }, body: form });
  if (!r.ok) { const e=await r.json(); throw new Error(e?.error?.message || r.status); }
  return { action: existing ? "updated" : "created", filename, email };
};

/** Download latest backup from Drive. Returns { data, file, email } */
const gdLoad = async () => {
  const { email } = await gdAuth();
  if (!email) throw new Error("Could not retrieve your Google email. Please try again.");
  const file = await gdFindFile(email);
  if (!file) throw new Error(`No backup found in Drive for ${email}.
Make a backup first.`);
  const data = await gdFetch(`/drive/v3/files/${file.id}?alt=media`);
  return { data, file, email };
};

// ════════════════════════════════════════════════════════════════════════════════
//  DEMO ACCOUNT  (username: demo  /  code: DEMO2024)
// ════════════════════════════════════════════════════════════════════════════════
const DEMO_USER = "demo";
const DEMO_CODE = "DEMO2024";   // shown on the login screen

/** Seed the demo account with realistic sample data (idempotent) */
const seedDemo = () => {
  const users = getUsers();
  if (!users[DEMO_USER]) {
    // password hash for "DEMO2024" — pre-computed SHA-256
    // We store a sentinel hash; login bypasses hash check for demo
    users[DEMO_USER] = {
      hash: "__demo__",
      displayName: "Demo User",
      createdAt: "2024-01-01T00:00:00.000Z",
      isDemo: true,
    };
    saveUsers(users);
  }

  // Only seed data if not already seeded
  if (uGet(DEMO_USER,"f_seeded",false)) return;

  // ── Salary ──────────────────────────────────────────────────────────────────
  uSet(DEMO_USER,"f_sa",18000);
  uSet(DEMO_USER,"f_sc","AED");
  uSet(DEMO_USER,"f_sd","25");
  uSet(DEMO_USER,"f_dc","AED");
  uSet(DEMO_USER,"f_pd",800);

  // ── Income entries (last 6 months) ──────────────────────────────────────────
  const now = new Date();
  const dIncs = [];
  for (let m=5; m>=0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth()-m, 1);
    const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,"0");
    // Investment return every month
    dIncs.push({id:Date.now()+m*100,   date:`${y}-${mo}-05`, type:"Investment Return", label:"Mutual Fund - HDFC", amount:1200+(m*80), currency:"INR", note:"SIP redemption"});
    // Rental income alternate months
    if (m%2===0) dIncs.push({id:Date.now()+m*100+1, date:`${y}-${mo}-01`, type:"Rental Income",    label:"Apartment 4B rent",  amount:500, currency:"USD", note:""});
    // Bonus in month 3
    if (m===3)   dIncs.push({id:Date.now()+m*100+2, date:`${y}-${mo}-15`, type:"Bonus",            label:"Q3 Performance Bonus", amount:5000, currency:"AED", note:"Annual bonus"});
    // Freelance in month 1
    if (m===1)   dIncs.push({id:Date.now()+m*100+3, date:`${y}-${mo}-20`, type:"Freelance",        label:"Web project - client", amount:800, currency:"USD", note:""});
  }
  uSet(DEMO_USER,"f_incs",dIncs);

  // ── Expense entries (last 6 months) ─────────────────────────────────────────
  const dExps = [];
  for (let m=5; m>=0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth()-m, 1);
    const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,"0");
    const entries = [
      {cat:"Rent / Mortgage",   lbl:"Al Barsha apartment",  amt:6500, cur:"AED", day:"01"},
      {cat:"School Fees",        lbl:"Kids school term fee", amt:1200, cur:"AED", day:"02"},
      {cat:"Electricity",        lbl:"DEWA bill",            amt:380+(m*10), cur:"AED", day:"05"},
      {cat:"Internet / Phone",   lbl:"Etisalat plan",        amt:299, cur:"AED", day:"05"},
      {cat:"Grocery",            lbl:"Carrefour weekly",     amt:1400+(m*50), cur:"AED", day:"10"},
      {cat:"School Transport",   lbl:"Bus service monthly",  amt:450, cur:"AED", day:"02"},
      {cat:"Car Loan EMI",       lbl:"Toyota Camry EMI",     amt:2100, cur:"AED", day:"15"},
      {cat:"Credit Card Payment",lbl:"ENBD credit card",     amt:1800+(m*30), cur:"AED", day:"20"},
      {cat:"Chitty / Chit Fund", lbl:"Kerala chit group",    amt:5000, cur:"INR", day:"01"},
      {cat:"Fuel",               lbl:"ENOC station",         amt:220, cur:"AED", day:"12"},
      {cat:"Medical / Pharmacy", lbl:"Aster pharmacy",       amt:180, cur:"AED", day:"18"},
      {cat:"Subscription (OTT)", lbl:"Netflix + Spotify",    amt:89, cur:"AED", day:"07"},
    ];
    entries.forEach((e,i)=>dExps.push({
      id: Date.now()+m*1000+i,
      date: `${y}-${mo}-${e.day}`,
      category: e.cat, label: e.lbl, amount: e.amt, currency: e.cur, note: ""
    }));
  }
  uSet(DEMO_USER,"f_exps",dExps);

  // ── Savings records (last 6 months) ─────────────────────────────────────────
  const dSav = {};
  for (let m=5; m>=1; m--) {
    const d = new Date(now.getFullYear(), now.getMonth()-m, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    dSav[k] = { savedAmt: 1500+(m*200), savedCur:"AED", customEdited:true,
                pettyBudget:800, pettySpent: 400+(m*30) };
  }
  // Current month — auto (not custom-edited)
  const curK = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  dSav[curK] = { savedAmt:0, savedCur:"AED", customEdited:false,
                 pettyBudget:800, pettySpent:320 };
  uSet(DEMO_USER,"f_sav",dSav);

  // ── Loan planner ─────────────────────────────────────────────────────────────
  uSet(DEMO_USER,"loan_p",580000);
  uSet(DEMO_USER,"loan_r",7.5);
  uSet(DEMO_USER,"loan_n",216);
  uSet(DEMO_USER,"loan_sd","2024-01");
  uSet(DEMO_USER,"loan_de",false);
  uSet(DEMO_USER,"loan_dm",3);
  uSet(DEMO_USER,"loan_pps",[
    {id:1, mode:"once", ym:"2025-01", month:12, amount:30000, type:"tenure", startYm:"", endYm:"", interval:3},
    {id:2, mode:"monthly", ym:"", month:0, amount:5000, type:"tenure", startYm:"2025-06", endYm:"2026-06", interval:3},
  ]);

  uSet(DEMO_USER,"f_seeded",true);
};


// ════════════════════════════════════════════════════════════════════════════════
//  BACKUP / RESTORE MODAL
// ════════════════════════════════════════════════════════════════════════════════
function BackupModal({ username, displayName, dark, onClose, onRestored }) {
  const [phase,    setPhase]   = useState("idle");  // idle | working | done | error
  const [msg,      setMsg]     = useState("");
  const [subMsg,   setSubMsg]  = useState("");
  const [gdEmail,  setGdEmail] = useState("");       // google email shown after auth
  const [cid,      setCid]     = useState(()=>localStorage.getItem("slfp_gd_cid")||"");
  const [cidSaved, setCidSaved]= useState(!!localStorage.getItem("slfp_gd_cid"));
  const [showCid,  setShowCid] = useState(false);

  const bdr = dark?"bg-slate-900 border-slate-800":"bg-white border-slate-200 shadow-2xl";
  const row = dark?"bg-slate-800 border-slate-700":"bg-slate-50 border-slate-200";
  const inp = dark?"bg-slate-700 border-slate-600 text-white focus:ring-amber-500 placeholder-slate-500"
                  :"bg-white border-slate-200 text-slate-800 focus:ring-blue-400";

  const saveCid = () => {
    const v = cid.trim();
    if (!v) return;
    localStorage.setItem("slfp_gd_cid", v);
    // Reset token client so it picks up new CID
    _gdClient = null; _gdToken = null; _gdEmail = null;
    setCidSaved(true);
    setShowCid(false);
    setMsg(""); setPhase("idle");
  };

  const runBackup = async () => {
    if (!localStorage.getItem("slfp_gd_cid")) { setShowCid(true); setMsg("⚠️ Enter your Google Client ID first."); return; }
    setPhase("working"); setMsg("Opening Google sign-in…"); setSubMsg(""); setGdEmail("");
    try {
      const { email } = await gdAuth();
      setGdEmail(email || "");
      setMsg(`Signed in as ${email || "unknown"}. Uploading…`);
      setSubMsg("Saving to Google Drive…");
      const res = await gdSave(username);
      setPhase("done");
      setMsg(`✅ Backed up to ${res.email}`);
      setSubMsg(`File: ${res.filename} — ${res.action} in your Drive`);
    } catch(e) {
      if (e.message === "NO_CLIENT_ID") { setShowCid(true); setMsg("⚠️ Enter your Google Client ID first."); setPhase("idle"); }
      else { setPhase("error"); setMsg("❌ " + e.message); setSubMsg(""); }
    }
  };

  const runRestore = async () => {
    if (!localStorage.getItem("slfp_gd_cid")) { setShowCid(true); setMsg("⚠️ Enter your Google Client ID first."); return; }
    setPhase("working"); setMsg("Opening Google sign-in…"); setSubMsg(""); setGdEmail("");
    try {
      const { email } = await gdAuth();
      setGdEmail(email || "");
      setMsg(`Signed in as ${email || "unknown"}. Looking for backup…`);
      const { data, file, email: fEmail } = await gdLoad();
      setSubMsg(`Found: ${file.name} (${new Date(file.modifiedTime).toLocaleDateString()})`);
      importData(username, data);
      setPhase("done");
      setMsg(`✅ Restored from ${fEmail}`);
      setSubMsg(`Data from ${file.name} — reloading…`);
      setTimeout(() => { onClose(); onRestored(); }, 2000);
    } catch(e) {
      if (e.message === "NO_CLIENT_ID") { setShowCid(true); setMsg("⚠️ Enter your Google Client ID first."); setPhase("idle"); }
      else { setPhase("error"); setMsg("❌ " + e.message); setSubMsg(""); }
    }
  };

  const runDownload = () => {
    dlJSON(exportData(username), `finance-planner-${username}-${new Date().toISOString().slice(0,10)}.json`);
    setMsg("✅ Backup file downloaded."); setSubMsg("Email it or keep it as a local copy."); setPhase("done");
  };

  const handleFileImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        importData(username, JSON.parse(ev.target.result));
        setPhase("done"); setMsg("✅ Data restored from file."); setSubMsg("Reloading…");
        setTimeout(() => { onClose(); onRestored(); }, 1800);
      } catch { setPhase("error"); setMsg("❌ Invalid backup file — could not parse JSON."); }
    };
    reader.readAsText(file);
  };

  const busy = phase === "working";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{background:"rgba(0,0,0,0.82)",backdropFilter:"blur(8px)"}}>
      <div className={`rounded-2xl border p-6 w-full max-w-md shadow-2xl ${bdr}`}>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className={`text-base font-black ${dark?"text-amber-400":"text-blue-700"}`}>☁️ Backup & Restore</h2>
            <p className={`text-xs mt-0.5 ${dark?"text-slate-400":"text-slate-500"}`}>
              Data backed up using your <strong>Google email</strong> as identifier
            </p>
          </div>
          <button onClick={onClose}
            className={`text-xl leading-none px-2 py-0.5 rounded-lg ${dark?"text-slate-500 hover:text-white hover:bg-slate-700":"text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}>
            ✕
          </button>
        </div>

        {/* ── Google Client ID config (collapsible) ─────────────────────────── */}
        <div className={`rounded-xl border mb-3 overflow-hidden ${dark?"border-slate-700":"border-slate-200"}`}>
          <button onClick={()=>setShowCid(v=>!v)}
            className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold transition-colors
              ${dark?"bg-slate-800 hover:bg-slate-700 text-slate-300":"bg-slate-50 hover:bg-slate-100 text-slate-600"}`}>
            <span className="flex items-center gap-2">
              <span>⚙️</span>
              <span>{cidSaved ? "Google Client ID configured" : "⚠️ Google Client ID required"}</span>
              {cidSaved && <span className={`px-2 py-0.5 rounded-full text-xs font-black ${dark?"bg-green-900/50 text-green-400":"bg-green-100 text-green-700"}`}>✓ Set</span>}
            </span>
            <span className={dark?"text-slate-500":"text-slate-400"}>{showCid?"▲":"▼"}</span>
          </button>
          {showCid && (
            <div className={`px-4 pb-4 pt-3 border-t space-y-2 ${dark?"border-slate-700 bg-slate-800":"border-slate-200 bg-white"}`}>
              <p className={`text-xs leading-relaxed ${dark?"text-slate-400":"text-slate-500"}`}>
                Create a <strong>Web OAuth 2.0 Client ID</strong> in{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
                   className={`underline font-semibold ${dark?"text-amber-400":"text-blue-600"}`}>
                  Google Cloud Console
                </a>.
                Add your GitHub Pages URL as an <strong>Authorised JavaScript origin</strong>
                (e.g. <code className="font-mono text-xs">https://yourusername.github.io</code>).
                Enable <strong>Google Drive API</strong> in the same project.
              </p>
              <input
                value={cid} onChange={e=>setCid(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                className={`w-full rounded-lg px-3 py-2 text-xs font-mono border outline-none focus:ring-2 ${inp}`}
              />
              <button onClick={saveCid}
                disabled={!cid.trim()}
                className={`w-full py-2 rounded-lg text-xs font-black transition-all
                  ${cid.trim() ? dark?"bg-amber-500 text-slate-900 hover:bg-amber-400":"bg-blue-600 text-white hover:bg-blue-500"
                               : "opacity-40 cursor-not-allowed bg-slate-400 text-white"}`}>
                Save Client ID
              </button>
            </div>
          )}
        </div>

        {/* ── Google Drive backup/restore ────────────────────────────────────── */}
        <div className={`rounded-xl border p-4 mb-3 ${row}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                 style={{background:"linear-gradient(135deg,#4285F4,#34A853,#FBBC05,#EA4335)"}}>
              <span className="text-xs">G</span>
            </div>
            <div>
              <p className={`text-xs font-black ${dark?"text-white":"text-slate-800"}`}>Google Drive</p>
              <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                {gdEmail
                  ? <>Signed in as <strong className={dark?"text-green-400":"text-green-600"}>{gdEmail}</strong></>
                  : "Sign in → backup saved under your Google email"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={runBackup} disabled={busy}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all
                ${busy?"opacity-50 cursor-wait scale-95":dark?"bg-amber-500 hover:bg-amber-400 text-slate-900 active:scale-95":"bg-blue-600 hover:bg-blue-500 text-white active:scale-95"}`}>
              {busy && msg.includes("Upload") ? "⚙️ Uploading…" : "☁️ Backup Now"}
            </button>
            <button onClick={runRestore} disabled={busy}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black border transition-all
                ${busy?"opacity-50 cursor-wait":dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10 active:scale-95":"border-blue-200 text-blue-600 hover:bg-blue-50 active:scale-95"}`}>
              {busy && msg.includes("Restor") ? "⚙️ Restoring…" : "⬇️ Restore"}
            </button>
          </div>
        </div>

        {/* ── Local file backup ──────────────────────────────────────────────── */}
        <div className={`rounded-xl border p-4 mb-3 ${row}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">💾</span>
            <div>
              <p className={`text-xs font-black ${dark?"text-white":"text-slate-800"}`}>Local File Backup</p>
              <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>Download · email · import from any device</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={runDownload}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black border transition-all active:scale-95
                ${dark?"border-slate-600 text-slate-300 hover:bg-slate-700":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              ⬇️ Download JSON
            </button>
            <label className={`flex-1 py-2.5 rounded-xl text-xs font-black border text-center cursor-pointer transition-all active:scale-95
              ${dark?"border-slate-600 text-slate-300 hover:bg-slate-700":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              📂 Import File
              <input type="file" accept=".json" className="hidden" onChange={handleFileImport}/>
            </label>
          </div>
        </div>

        {/* ── Status ─────────────────────────────────────────────────────────── */}
        {(msg || subMsg) && (
          <div className={`rounded-xl px-4 py-3 text-xs mt-1 space-y-0.5
            ${phase==="done"  ? dark?"bg-green-900/40 border border-green-700/40 text-green-300"  :"bg-green-50 border border-green-200 text-green-700"
             :phase==="error" ? dark?"bg-red-900/40 border border-red-700/40 text-red-300"        :"bg-red-50 border border-red-200 text-red-600"
             :                  dark?"bg-slate-800 border border-slate-700 text-slate-300"         :"bg-slate-50 border border-slate-200 text-slate-600"}`}>
            {msg    && <p className="font-semibold">{msg}</p>}
            {subMsg && <p className={dark?"text-slate-400":"text-slate-500"}>{subMsg}</p>}
          </div>
        )}

        <p className={`text-xs mt-3 text-center ${dark?"text-slate-600":"text-slate-400"}`}>
          Backs up: income · expenses · savings · petty cash · salary · loan data
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  LOGIN / REGISTER SCREEN
// ════════════════════════════════════════════════════════════════════════════════
function AuthScreen({onLogin, dark}) {
  const [mode,    setMode]    = useState("login");   // "login" | "register"
  const [uname,   setUname]   = useState("");
  const [dispName,setDispName]= useState("");
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [showPw,  setShowPw]  = useState(false);
  const [err,     setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  const bg  = dark?"bg-slate-950":"bg-slate-50";
  const crd = dark?"bg-slate-900 border-slate-800":"bg-white border-slate-200 shadow-xl";
  const inp = dark
    ?"bg-slate-800 border-slate-600 text-white focus:ring-amber-500 focus:border-amber-500 placeholder-slate-500"
    :"bg-white border-slate-200 text-slate-800 focus:ring-blue-400 focus:border-blue-400 placeholder-slate-400";
  const accentBtn = dark?"bg-amber-500 hover:bg-amber-400 text-slate-900":"bg-blue-600 hover:bg-blue-500 text-white";

  const handleDemoLogin = () => {
    seedDemo();
    const session = { username: DEMO_USER, displayName: "Demo User", isDemo: true };
    saveSession(session);
    onLogin(session);
  };

  const handleSubmit = async () => {
    setErr(""); setLoading(true);
    try {
      const users = getUsers();
      if (mode==="register") {
        if (!uname.trim())          return setErr("Username is required.");
        if (uname.includes(" "))    return setErr("Username cannot contain spaces.");
        if (uname.length < 3)       return setErr("Username must be at least 3 characters.");
        if (!dispName.trim())       return setErr("Display name is required.");
        if (pw.length < 4)          return setErr("Password must be at least 4 characters.");
        if (pw !== pw2)             return setErr("Passwords do not match.");
        const id = uname.trim().toLowerCase();
        if (users[id])              return setErr("Username already exists. Please log in.");
        const hash = await hashPw(pw);
        users[id] = { hash, displayName: dispName.trim(), createdAt: new Date().toISOString() };
        saveUsers(users);
        const session = { username: id, displayName: dispName.trim() };
        saveSession(session);
        onLogin(session);
      } else {
        const id = uname.trim().toLowerCase();
        if (!users[id])             return setErr("Username not found. Please register.");
        const hash = await hashPw(pw);
        if (hash !== users[id].hash) return setErr("Incorrect password.");
        const session = { username: id, displayName: users[id].displayName };
        saveSession(session);
        onLogin(session);
      }
    } finally { setLoading(false); }
  };

  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4`}
         style={{fontFamily:"'DM Mono','Fira Code',monospace"}}>
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏦</div>
          <h1 className={`text-2xl font-black tracking-tight ${dark?"text-amber-400":"text-blue-700"}`}>
            Smart Loan & Finance Planner
          </h1>
          <p className={`text-xs mt-1 ${dark?"text-slate-500":"text-slate-400"}`}>
            Your personal financial command centre
          </p>
        </div>

        {/* Card */}
        <div className={`rounded-2xl border p-8 ${crd}`}>

          {/* Mode tabs */}
          <div className={`flex rounded-xl p-1 mb-6 ${dark?"bg-slate-800":"bg-slate-100"}`}>
            {[{id:"login",l:"Sign In"},{id:"register",l:"Create Account"}].map(t=>(
              <button key={t.id} onClick={()=>{setMode(t.id);setErr("");}}
                className={`flex-1 py-2 text-xs font-black rounded-lg transition-all
                  ${mode===t.id
                    ? dark?"bg-amber-500 text-slate-900":"bg-white text-blue-700 shadow-sm"
                    : dark?"text-slate-400":"text-slate-500"}`}>
                {t.l}
              </button>
            ))}
          </div>

          <div className="space-y-4">

            {/* Display name (register only) */}
            {mode==="register" && (
              <div>
                <label className={`text-xs font-semibold uppercase tracking-widest block mb-1.5 ${dark?"text-amber-400":"text-slate-500"}`}>
                  Display Name
                </label>
                <input value={dispName} onChange={e=>setDispName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className={`w-full rounded-xl px-4 py-3 text-sm font-mono border outline-none focus:ring-2 transition-all ${inp}`}/>
              </div>
            )}

            {/* Username */}
            <div>
              <label className={`text-xs font-semibold uppercase tracking-widest block mb-1.5 ${dark?"text-amber-400":"text-slate-500"}`}>
                Username
              </label>
              <input value={uname} onChange={e=>setUname(e.target.value)}
                placeholder={mode==="register"?"choose a username (no spaces)":"your username"}
                onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
                className={`w-full rounded-xl px-4 py-3 text-sm font-mono border outline-none focus:ring-2 transition-all ${inp}`}/>
            </div>

            {/* Password */}
            <div>
              <label className={`text-xs font-semibold uppercase tracking-widest block mb-1.5 ${dark?"text-amber-400":"text-slate-500"}`}>
                Password
              </label>
              <div className="relative">
                <input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)}
                  placeholder={mode==="register"?"min 4 characters":"your password"}
                  onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
                  className={`w-full rounded-xl px-4 py-3 pr-12 text-sm font-mono border outline-none focus:ring-2 transition-all ${inp}`}/>
                <button type="button" onClick={()=>setShowPw(v=>!v)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded-lg
                    ${dark?"text-slate-400 hover:text-amber-400":"text-slate-400 hover:text-blue-500"}`}>
                  {showPw?"🙈":"👁️"}
                </button>
              </div>
            </div>

            {/* Confirm password (register only) */}
            {mode==="register" && (
              <div>
                <label className={`text-xs font-semibold uppercase tracking-widest block mb-1.5 ${dark?"text-amber-400":"text-slate-500"}`}>
                  Confirm Password
                </label>
                <input type={showPw?"text":"password"} value={pw2} onChange={e=>setPw2(e.target.value)}
                  placeholder="repeat password"
                  onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-mono border outline-none focus:ring-2 transition-all ${inp}`}/>
              </div>
            )}

            {/* Error */}
            {err && (
              <div className={`rounded-xl px-4 py-3 text-xs font-semibold
                ${dark?"bg-red-900/40 border border-red-700/40 text-red-300":"bg-red-50 border border-red-200 text-red-600"}`}>
                ⚠️ {err}
              </div>
            )}

            {/* Submit */}
            <button onClick={handleSubmit} disabled={loading}
              className={`w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all
                ${loading?"opacity-60 cursor-wait scale-95":"hover:scale-[1.01]"} ${accentBtn}`}>
              {loading?"⚙️ Please wait…":mode==="login"?"🔓 Sign In":"✨ Create Account"}
            </button>
          </div>

          {/* Footer note */}
          <p className={`text-xs text-center mt-5 ${dark?"text-slate-600":"text-slate-400"}`}>
            {mode==="login"
              ? "Don't have an account? Switch to Create Account above."
              : "All data is stored locally in this browser only."}
          </p>
        </div>

        {/* ── Demo account banner ─────────────────────────────────────────── */}
        <div className={`mt-5 rounded-2xl border p-5 ${dark?"bg-slate-900 border-amber-700/30":"bg-amber-50 border-amber-200"}`}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">🎮</span>
            <div className="flex-1">
              <p className={`text-sm font-black mb-1 ${dark?"text-amber-400":"text-amber-700"}`}>Try the Demo Account</p>
              <p className={`text-xs mb-3 ${dark?"text-slate-400":"text-slate-600"}`}>
                Explore with pre-loaded salaries, expenses, investments & a loan plan — no sign-up needed.
              </p>
              <div className={`rounded-xl p-3 mb-3 text-xs font-mono space-y-1 ${dark?"bg-slate-800 border border-slate-700":"bg-white border border-amber-100"}`}>
                <div className="flex justify-between">
                  <span className={dark?"text-slate-400":"text-slate-500"}>Username</span>
                  <span className={`font-black ${dark?"text-amber-400":"text-amber-600"}`}>demo</span>
                </div>
                <div className="flex justify-between">
                  <span className={dark?"text-slate-400":"text-slate-500"}>Access Code</span>
                  <span className={`font-black tracking-widest ${dark?"text-amber-400":"text-amber-600"}`}>{DEMO_CODE}</span>
                </div>
              </div>
              <button onClick={handleDemoLogin}
                className={`w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all hover:scale-[1.01]
                  ${dark?"bg-amber-500 hover:bg-amber-400 text-slate-900":"bg-amber-500 hover:bg-amber-400 text-white"}`}>
                🚀 Enter Demo Account
              </button>
            </div>
          </div>
        </div>

        {/* Existing users hint */}
        {Object.keys(getUsers()).filter(u=>u!==DEMO_USER).length>0 && mode==="login" && (
          <p className={`text-xs text-center mt-3 ${dark?"text-slate-600":"text-slate-400"}`}>
            Registered users: {Object.keys(getUsers()).filter(u=>u!==DEMO_USER).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  RESET CONFIRMATION MODAL
// ════════════════════════════════════════════════════════════════════════════════
function ResetModal({username, displayName, dark, onConfirm, onCancel}) {
  const [step,  setStep]  = useState(1);   // 1 = warn, 2 = type confirm
  const [typed, setTyped] = useState("");
  const WORD = "RESET";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
         style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(4px)"}}>
      <div className={`rounded-2xl border p-8 w-full max-w-md shadow-2xl
        ${dark?"bg-slate-900 border-red-800/50":"bg-white border-red-200"}`}>

        <div className="text-center mb-6">
          <span className="text-4xl">⚠️</span>
          <h2 className={`text-lg font-black mt-3 ${dark?"text-red-400":"text-red-600"}`}>Reset All Data</h2>
          <p className={`text-sm mt-2 ${dark?"text-slate-300":"text-slate-600"}`}>
            This will permanently erase <strong>all financial data</strong> for <strong>{displayName}</strong>:
          </p>
        </div>

        <ul className={`text-xs space-y-1.5 mb-5 ${dark?"text-slate-400":"text-slate-500"}`}>
          {["All income entries","All expense entries","All savings records",
            "All petty cash records","Salary configuration","Loan planner data"].map(i=>(
            <li key={i} className="flex items-center gap-2">
              <span className="text-red-400">✕</span> {i}
            </li>
          ))}
        </ul>

        <div className={`rounded-xl p-3 mb-5 text-xs font-semibold
          ${dark?"bg-green-900/30 border border-green-700/40 text-green-300":"bg-green-50 border border-green-200 text-green-700"}`}>
          ✅ Your <strong>login credentials are NOT deleted</strong>. You can log back in after reset.
        </div>

        {step===1 ? (
          <div className="flex gap-3">
            <button onClick={onCancel}
              className={`flex-1 py-3 rounded-xl text-sm font-black border transition-all
                ${dark?"border-slate-700 text-slate-300 hover:bg-slate-800":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              Cancel
            </button>
            <button onClick={()=>setStep(2)}
              className="flex-1 py-3 rounded-xl text-sm font-black bg-red-600 hover:bg-red-500 text-white transition-all">
              Continue →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className={`text-xs ${dark?"text-slate-400":"text-slate-500"}`}>
              Type <strong className={dark?"text-red-400":"text-red-600"}>{WORD}</strong> to confirm:
            </p>
            <input value={typed} onChange={e=>setTyped(e.target.value.toUpperCase())}
              placeholder={WORD}
              className={`w-full rounded-xl px-4 py-3 text-sm font-mono border outline-none focus:ring-2 text-center font-black tracking-widest
                ${dark?"bg-slate-800 border-slate-600 text-white focus:ring-red-500":"bg-white border-slate-200 text-slate-800 focus:ring-red-400"}`}/>
            <div className="flex gap-3">
              <button onClick={()=>{setStep(1);setTyped("");}}
                className={`flex-1 py-3 rounded-xl text-sm font-black border transition-all
                  ${dark?"border-slate-700 text-slate-300 hover:bg-slate-800":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                ← Back
              </button>
              <button onClick={()=>typed===WORD&&onConfirm()} disabled={typed!==WORD}
                className={`flex-1 py-3 rounded-xl text-sm font-black transition-all
                  ${typed===WORD
                    ?"bg-red-600 hover:bg-red-500 text-white"
                    :"bg-red-900/30 text-red-700 cursor-not-allowed opacity-50"}`}>
                🗑️ Reset Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session,  setSession]  = useState(()=>getSession());
  const [dark,     setDark]     = useState(()=>localStorage.getItem("slfp_dark")==="light"?false:true);
  const [mainCur,  setMainCur]  = useState(CURRENCIES[0]);
  const [mainTab,  setMainTab]  = useState("loan");
  const [showReset,  setShowReset]  = useState(false);
  const [showMenu,   setShowMenu]   = useState(false);
  const [showBackup, setShowBackup] = useState(false);

  useEffect(()=>localStorage.setItem("slfp_dark",dark?"dark":"light"),[dark]);

  const handleLogin    = (s) => setSession(s);
  const handleLogout   = () => { clearSession(); setSession(null); setShowMenu(false); };
  const handleRestored = () => { setShowBackup(false); window.location.reload(); };
  const handleReset    = () => {
    uReset(session.username);
    setShowReset(false);
    setShowMenu(false);
    // force re-render of child tabs by remounting
    setMainTab(t=>t==="loan"?"loan":"finance");
    window.location.reload();
  };

  if (!session) return <AuthScreen onLogin={handleLogin} dark={dark}/>;

  const bg   = dark?"bg-slate-950 text-slate-100":"bg-slate-50 text-slate-900";
  const tOn  = dark?"bg-amber-500 text-slate-900 font-black":"bg-blue-600 text-white font-black";
  const tOff = dark?"text-slate-400 hover:text-amber-300":"text-slate-500 hover:text-blue-600";

  return (
    <div className={`min-h-screen ${bg} transition-colors duration-300`}
         style={{fontFamily:"'DM Mono','Fira Code',monospace"}}>

      {/* ── RESET MODAL ─────────────────────────────────────────────────────── */}
      {showReset && (
        <ResetModal
          username={session.username}
          displayName={session.displayName}
          dark={dark}
          onConfirm={handleReset}
          onCancel={()=>setShowReset(false)}
        />
      )}

      {/* ── BACKUP MODAL ─────────────────────────────────────────────────────── */}
      {showBackup && (
        <BackupModal
          username={session.username}
          displayName={session.displayName}
          dark={dark}
          onClose={()=>setShowBackup(false)}
          onRestored={handleRestored}
        />
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-50 border-b backdrop-blur
        ${dark?"bg-slate-950/95 border-slate-800":"bg-white/95 border-slate-200"}`}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏦</span>
            <div>
              <h1 className={`text-base sm:text-lg font-black tracking-tight ${dark?"text-amber-400":"text-blue-700"}`}>
                Smart Loan & Finance Planner
              </h1>
              <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>
                Reducing-balance · Date-based entries · Live FX
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <select value={mainCur.code} onChange={e=>setMainCur(CURRENCIES.find(c=>c.code===e.target.value))}
              className={`text-xs rounded-lg px-2 py-1.5 border outline-none
                ${dark?"bg-slate-800 border-slate-700 text-white":"bg-slate-50 border-slate-200 text-slate-800"}`}>
              {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>

            <button onClick={()=>setDark(d=>!d)}
              className={`rounded-lg px-3 py-1.5 text-xs border transition-all
                ${dark?"border-slate-700 text-amber-400 hover:bg-slate-800":"border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
              {dark?"☀️":"🌙"}
            </button>

            {/* User menu */}
            <div className="relative">
              <button onClick={()=>setShowMenu(v=>!v)}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold border transition-all
                  ${dark?"border-amber-500/40 text-amber-400 hover:bg-amber-500/10":"border-blue-200 text-blue-600 hover:bg-blue-50"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black
                  ${dark?"bg-amber-500 text-slate-900":"bg-blue-600 text-white"}`}>
                  {session.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:inline max-w-[120px] truncate">{session.displayName}</span>
                <span>{showMenu?"▲":"▼"}</span>
              </button>

              {showMenu && (
                <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl border shadow-2xl z-50 overflow-hidden
                  ${dark?"bg-slate-900 border-slate-700":"bg-white border-slate-200"}`}>

                  {/* User info */}
                  <div className={`px-4 py-3 border-b ${dark?"border-slate-700":"border-slate-100"}`}>
                    <p className={`text-sm font-black ${dark?"text-white":"text-slate-800"}`}>{session.displayName}</p>
                    <p className={`text-xs ${dark?"text-slate-500":"text-slate-400"}`}>@{session.username}</p>
                    {session.isDemo && (
                    <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-black
                      ${dark?"bg-amber-500/20 text-amber-400 border border-amber-500/30":"bg-amber-100 text-amber-700 border border-amber-200"}`}>
                      🎮 Demo Account
                    </span>
                  )}
                  {!session.isDemo && (
                    <p className={`text-xs mt-1 ${dark?"text-slate-600":"text-slate-300"}`}>
                      Member since {new Date(getUsers()[session.username]?.createdAt||Date.now()).toLocaleDateString()}
                    </p>
                  )}
                  </div>

                  {/* Menu items */}
                  <div className="py-1">
                    <button onClick={()=>{setShowMenu(false);setShowBackup(true);}}
                      className={`w-full text-left px-4 py-3 text-xs font-semibold flex items-center gap-3 transition-colors
                        ${dark?"text-green-400 hover:bg-green-900/30":"text-green-600 hover:bg-green-50"}`}>
                      <span>☁️</span>
                      <div>
                        <p className="font-black">Backup & Restore</p>
                        <p className={`text-xs font-normal ${dark?"text-slate-500":"text-slate-400"}`}>Google Drive · Local file</p>
                      </div>
                    </button>

                    <div className={`mx-3 border-t ${dark?"border-slate-700":"border-slate-100"}`}/>

                    <button onClick={()=>{setShowMenu(false);setShowReset(true);}}
                      className={`w-full text-left px-4 py-3 text-xs font-semibold flex items-center gap-3 transition-colors
                        ${dark?"text-red-400 hover:bg-red-900/30":"text-red-500 hover:bg-red-50"}`}>
                      <span>🗑️</span>
                      <div>
                        <p className="font-black">Reset All Data</p>
                        <p className={`text-xs font-normal ${dark?"text-slate-500":"text-slate-400"}`}>Erase finance & loan data</p>
                      </div>
                    </button>

                    <div className={`mx-3 border-t ${dark?"border-slate-700":"border-slate-100"}`}/>

                    <button onClick={handleLogout}
                      className={`w-full text-left px-4 py-3 text-xs font-semibold flex items-center gap-3 transition-colors
                        ${dark?"text-slate-300 hover:bg-slate-800":"text-slate-600 hover:bg-slate-50"}`}>
                      <span>🚪</span>
                      <div>
                        <p className="font-black">Sign Out</p>
                        <p className={`text-xs font-normal ${dark?"text-slate-500":"text-slate-400"}`}>Your data stays safe</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Nav tabs */}
        <div className={`border-t ${dark?"border-slate-800":"border-slate-100"}`}>
          <div className="max-w-7xl mx-auto px-4 flex gap-1 py-2">
            {[{id:"loan",l:"🏦 Loan Planner"},{id:"finance",l:"💼 Salary & Expenses"}].map(t=>(
              <button key={t.id} onClick={()=>setMainTab(t.id)}
                className={`px-5 py-2 text-xs rounded-xl transition-all ${mainTab===t.id?tOn:tOff}`}>{t.l}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Close menu on outside click */}
      {showMenu && <div className="fixed inset-0 z-40" onClick={()=>setShowMenu(false)}/>}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {mainTab==="loan"    && <LoanTab    key={session.username} dark={dark} baseCurrency={mainCur} user={session.username}/>}
        {mainTab==="finance" && <FinanceTab key={session.username} dark={dark} user={session.username}/>}
        <footer className={`text-center text-xs pt-6 pb-4 ${dark?"text-slate-700":"text-slate-400"}`}>
          Smart Loan & Finance Planner · All data stored locally · Signed in as {session.displayName}
        </footer>
      </div>
    </div>
  );
}
