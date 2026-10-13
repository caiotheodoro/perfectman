"""One refinement round: N seeds -> run -> extract -> 2 judges. Usage: round.py <label> <demoDir> [model] [seeds]"""
import json,sys,os,re,time,subprocess,urllib.request,glob,statistics
S=os.path.dirname(os.path.abspath(__file__)); label=sys.argv[1]; D=sys.argv[2]; model=sys.argv[3] if len(sys.argv)>3 else "deepseek-v4.1-flash"
seeds=[int(x) for x in (sys.argv[4] if len(sys.argv)>4 else "7,8,9").split(",")]
API="http://127.0.0.1:4318"; OUT=f"{S}/rounds/{label}"; os.makedirs(OUT,exist_ok=True)
JUDGES=["glm-5.3-flash","qwen3.8-flash"]
def http(path,body=None):
    r=urllib.request.Request(API+path,json.dumps(body).encode() if body else None,{"content-type":"application/json"})
    return json.load(urllib.request.urlopen(r,timeout=120))
rd=lambda f:{"filename":os.path.basename(f),"text":open(f).read()}
scn=glob.glob(D+"/*.scenario.md")[0]
for seed in seeds:
    text=re.sub(r"^seed: \d+",f"seed: {seed}",open(scn).read(),count=1,flags=re.M)
    inputs={"kind":"markdown","personas":[rd(f) for f in sorted(glob.glob(D+"/*.persona.md"))],"scenario":{"filename":os.path.basename(scn),"text":text}}
    req={"inputs":inputs,"llm":{"providerType":"openai-compatible","modelName":model,"baseUrl":"http://127.0.0.1:4399/v1","apiKey":"proxy-adds-real-key","temperature":1.0,"maxOutputTokens":400,"extraBody":{"thinking":{"type":"disabled"}}},"limits":{"maxPulses":24,"wallClockCapMs":900000}}
    res=http("/api/runs",req); rid=res["runId"]
    while True:
        s=http("/api/runs/current")
        if s["state"] in("done","failed","stopped"): break
        time.sleep(5)
    if s["state"]!="done": print(label,seed,"FAILED",s.get("error")); continue
    tx=f"{OUT}/seed{seed}.txt"
    subprocess.run(["python3",f"{S}/extract.py",f"{S}/runs/{rid}",tx],check=True,capture_output=True)
    for j in JUDGES:
        for attempt in range(2):
            p=subprocess.run(["python3",f"{S}/judge.py",S,tx,j,f"{OUT}/seed{seed}.{j}.json"],capture_output=True,text=True,timeout=400)
            if p.returncode==0: break
    print(label,"seed",seed,"done",rid,flush=True)
# aggregate
axes=json.load(open(S+"/rubric.json"))["axes"].keys(); agg={}; stats=[]
for j in JUDGES:
    fs=glob.glob(f"{OUT}/seed*.{j}.json"); agg[j]={a:round(statistics.mean(json.load(open(f))["scores"][a] for f in fs),2) for a in axes} if fs else {}
for f in glob.glob(f"{OUT}/seed*.stats.json"): stats.append(json.load(open(f)))
m=lambda k:round(statistics.mean(x[k] for x in stats),1) if stats else None
summary={"label":label,"model":model,"seeds":seeds,"judge_means":agg,"both_min":{a:min(agg[j][a] for j in JUDGES if agg[j]) for a in axes} if all(agg.values()) else {},
 "chars_per_msg":m("mean_msg_chars"),"s_per_pulse":m("s_per_pulse"),"messages":m("messages"),"replies":m("replies"),"nonpublic":m("non_public_msgs"),"pulse_gap_median_s":m("pulse_gap_median_s"),"llm_failures":sum(x["llm_failures"] for x in stats)}
json.dump(summary,open(f"{OUT}/summary.json","w"),indent=1); print(json.dumps(summary,indent=1))
