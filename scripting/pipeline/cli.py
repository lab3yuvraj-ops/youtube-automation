import argparse, os
from pathlib import Path
from .models import new_project, load, save, log
from .anthropic_client import ScriptClient
from . import prompts, parsers, stages

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest="cmd",required=True)
    n=sub.add_parser("new"); n.add_argument("--project-id",required=True); n.add_argument("--method",choices=["A","B"],required=True); n.add_argument("--category",default=""); n.add_argument("--concept",default=""); n.add_argument("--ideas",type=int,default=5); n.add_argument("--model",default=None)
    c=sub.add_parser("choose"); c.add_argument("--project",required=True); c.add_argument("--index",type=int,required=True)
    r=sub.add_parser("run"); r.add_argument("--project",required=True); r.add_argument("--language",default="Hindi"); r.add_argument("--duration",type=int,required=True); r.add_argument("--monster",required=True); r.add_argument("--scene-count",type=int,default=None); r.add_argument("--model",default=None)
    a=ap.parse_args()
    if a.cmd=="new":
        val=a.category if a.method=="A" else a.concept; p=Path("projects")/a.project_id/"pipeline.json"; project=new_project(a.project_id,a.method,val,a.ideas); save(p,project); client=ScriptClient(model=a.model); raw=client.complete(prompts.render("ideas",{"CATEGORY":a.category,"CONCEPT":a.concept,"NUMBER_OF_IDEAS":a.ideas})); project["idea"].update(status="done",items=parsers.ideas(raw),raw_output=raw); save(p,project); print(f"Created {p}"); [print(f"{x['index']}. {x.get('title','')}") for x in project['idea']['items']]
    elif a.cmd=="choose":
        project=load(a.project); items=project["idea"]["items"]; chosen=next((x for x in items if x["index"]==a.index),None)
        if not chosen:
            raise SystemExit(f"No idea index {a.index}")
        project["idea"].update(selected_index=a.index,selected=chosen); save(a.project,project); print("Selected",chosen.get("title"))
    else:
        project=load(a.project); stages.run_all(project,ScriptClient(model=a.model),a.language,a.duration,a.monster,scene_count=a.scene_count,checkpoint=lambda: save(a.project,project)); save(a.project,project); print(f"Pipeline complete: {a.project}")
if __name__ == "__main__": main()
