import json,sys,urllib.request,re
S=sys.argv[1]; tr=open(sys.argv[2]).read(); stats=open(sys.argv[2].replace('.txt','.stats.json')).read()
rub=json.load(open(S+"/rubric.json"))
import os
scene=open(os.environ.get("SCENE_FILE",S+"/demo/cat-on-the-roof.scenario.md")).read().split("## Room Context")[1]
story = bool(re.search(r"^\[\d{1,2}:\d{2}(am|pm) p\d+", tr, re.M))
TIMING_NOTE = ("Timestamps are the STORY CLOCK (the fiction's time of day); pN is the simulation pulse; #channel is where it was posted (building = public group, others private). Judge temporal_realism on the story clock: cadence of bursts and lulls, characters noticing the hour, plausible gaps. The real compute time of the run (below) is NOT story time and must not count against temporal_realism. Compute metrics: "+stats) if story else ("RUN METRICS (wall-clock, for temporal_realism): "+stats+"\nTimestamps t+Ns are seconds since run start; pN is the simulation pulse; #channel is where it was posted (building = public group, others private).")
prompt=f"""You are a strict, fair editor judging a simulated group-chat scene for a reader audience.
GOAL OF THE EXPERIMENT: {rub['goal']}

SCENE BRIEF AND SECRETS (the characters do not know each other's secrets):
{scene}

{TIMING_NOTE}

TRANSCRIPT:
{tr}

RUBRIC ({rub['scale']}):
{json.dumps(rub['axes'],indent=1)}

Return ONLY JSON: {{"scores":{{axis:int}},"evidence":{{axis:"<=25 words, quote or cite a moment"}},"best_line":"verbatim","worst_moment":"what and why","one_line_verdict":"..."}}"""
j=None
for budget in (7000,14000,14000):
    req_body={"model":sys.argv[3],"temperature":0,"max_tokens":budget,"messages":[{"role":"user","content":prompt}]}
    body=json.dumps(req_body).encode()
    r=urllib.request.Request("http://127.0.0.1:4399/v1/chat/completions",body,{"content-type":"application/json"})
    try: d=json.load(urllib.request.urlopen(r,timeout=300))
    except Exception as e: print("http error",e,file=sys.stderr); continue
    msg=d['choices'][0]['message']
    for c in (msg.get('content'),msg.get('reasoning_content')):
        if not c: continue
        for m in re.finditer(r"\{.*\}",c,re.S):
            try:
                cand=json.loads(m.group(0))
                if set(rub['axes'])<=set(cand.get('scores',{})): j=cand; break
            except Exception: pass
        if j: break
    if j: break
if not j: print("JUDGE FAILED",sys.argv[3],sys.argv[2],file=sys.stderr); sys.exit(2)
json.dump(j,open(sys.argv[4],"w"),indent=1)
sc=j['scores']; print(json.dumps(sc)); print("mean",round(sum(sc.values())/len(sc),2)); print(j['one_line_verdict']); print("BEST:",j['best_line'][:200]); print("WORST:",j['worst_moment'][:250])
