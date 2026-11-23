"""Tests for scripts/extension_store.py (sending the browser extension to the Edge and Chrome stores),
with stand-in stores that answer from a script instead of the network. Nothing leaves this computer.
Run: python3 scripts/extension_store_test.py (CI's `test` job and pr.yml run it)."""
import io, json, os, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))  # scripts/
sys.path.insert(0, HERE)  # so the script can be imported
import extension_store as es

failed = 0  # how many checks failed


def check(what, ok):
    global failed
    print(("PASS " if ok else "FAIL ") + what)
    failed += 0 if ok else 1


def stops(fn, *a, **k):
    """(did it stop with a failure, what it printed) for fn(*a, **k)."""
    out, old = io.StringIO(), sys.stdout
    sys.stdout = out
    try:
        fn(*a, **k)
        return False, out.getvalue()
    except SystemExit as e:
        return e.code == 1, out.getvalue()
    finally:
        sys.stdout = old


def quiet(fn, *a, **k):
    """(what fn returned, what it printed)."""
    out, old = io.StringIO(), sys.stdout
    sys.stdout = out
    try:
        return fn(*a, **k), out.getvalue()
    finally:
        sys.stdout = old


class Store:
    """A stand-in for the network: answers each request with the first rule whose (method, address part)
    matches, in order; a rule with a list of answers gives them one by one (the last one repeats).
    Every request is kept in `calls` as (method, url, headers, body)."""
    def __init__(self, rules):
        self.rules = [(m, part, list(a) if isinstance(a, list) else [a]) for m, part, a in rules]
        self.calls = []

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append((method, url, headers or {}, body))
        for m, part, answers in self.rules:
            if m == method and part in url:
                return answers.pop(0) if len(answers) > 1 else answers[0]
        raise AssertionError(f"nothing expected {method} {url}")


def ok(obj, status=200, headers=None):
    """A JSON answer."""
    return status, headers or {}, json.dumps(obj)


# ---- the package
with tempfile.TemporaryDirectory() as t:
    os.makedirs(os.path.join(t, "icons"))
    os.makedirs(os.path.join(t, ".git"))
    files = {"manifest.json": json.dumps({"name": "x", "version": "1.2.3", "key": "SECRETISH", "permissions": ["storage"]}).encode(),
             "page.js": b"js", "icons/32.png": b"png", ".DS_Store": b"junk", ".git/x": b"junk"}
    for p, b in files.items():
        with open(os.path.join(t, p), "wb") as f:
            f.write(b)
    data, version = es.make_zip(t)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        m = json.loads(z.read("manifest.json"))
        times = {i.date_time for i in z.infolist()}
    check("the version is the manifest's", version == "1.2.3" and es.zip_version(data) == "1.2.3")
    check(f"the package holds the extension's files, in order, no hidden ones ({names})", names == ["icons/32.png", "manifest.json", "page.js"])
    check("its manifest has no key (the stores give their own id)", "key" not in m and m["permissions"] == ["storage"])
    check("every file has the same fixed time", times == {es.FIXED_TIME})
    check("the same files make the same zip, byte for byte", es.make_zip(t)[0] == data)
    os.remove(os.path.join(t, "manifest.json"))
    stopped, said = stops(es.make_zip, t)
    check("no manifest.json: stops", stopped and "No manifest.json" in said)
real, real_v = es.make_zip()  # the real browser/
check(f"the real extension packs ({real_v})", es.zip_version(real) == real_v and real_v.count(".") == 2)
check("the real manifest's key stays in the repo (the unpacked copy's id) but not in the package",
      "key" in json.load(open(os.path.join(es.BROWSER, "manifest.json"))) and b'"key"' not in zipfile.ZipFile(io.BytesIO(real)).read("manifest.json"))
notes = es.certification_notes(real)
check("the reviewers' notes name the version and each permission", real_v in notes and "nativeMessaging" in notes and "<all_urls>" in notes)

# ---- small helpers
check("operation id from a full Location address", es.operation_id({"Location": "https://api.addons.microsoftedge.microsoft.com/v1/products/p/submissions/operations/op-1"}) == "op-1")
check("…from a bare path, any capitals, a trailing /", es.operation_id({"location": "/v1/x/operations/op-2/"}) == "op-2")
check("newer: higher, as numbers", es.newer("1.1.10", "1.1.9") and not es.newer("1.1.2", "1.1.2") and not es.newer("1.1.1", "1.1.2"))
check("newer: nothing there yet", es.newer("1.0.0", ""))
check("Chrome's versions: published and waiting",
      es.chrome_versions({"publishedItemRevisionStatus": {"distributionChannels": [{"crxVersion": "1.1.0"}]},
                          "submittedItemRevisionStatus": {"distributionChannels": [{"crxVersion": "1.1.2"}, {"crxVersion": "1.1.10"}]}}) == ("1.1.0", "1.1.10"))
check("Chrome's versions: none", es.chrome_versions({}) == ("", ""))

# ---- Edge
EDGE_ENV = {"EDGE_CLIENT_ID": "cid", "EDGE_API_KEY": "k3y", "EDGE_PRODUCT_ID": "prod-1"}
data = real  # the package sent in these cases
v = real_v
older = "0.0.1"  # a version below it
nosleep = lambda s: None  # (no waiting in tests)
PUBLIC = ("GET", es.EDGE_PUBLIC + es.EDGE_STORE_ID)


def edge_store(public=older, upload=None, up_state=None, publish=None, pub_state=None):
    return Store([
        ("GET", es.EDGE_PUBLIC, ok({"name": "thinky highlights", "version": public})),
        ("POST", "/submissions/draft/package", upload or (202, {"Location": "/v1/products/prod-1/submissions/draft/package/operations/up-1"}, "")),
        ("GET", "/draft/package/operations/up-1", up_state or [ok({"status": "InProgress"}), ok({"status": "Succeeded"})]),
        ("POST", "/submissions", publish or (202, {"Location": "https://x/v1/products/prod-1/submissions/operations/pub-1"}, "")),
        ("GET", "/submissions/operations/pub-1", pub_state or ok({"status": "Succeeded"})),
    ])


s = Store([])
r, said = quiet(es.edge, data, env={}, http=s)
check(f"Edge not set up: skipped, nothing asked ({said.strip()})", r == "not set up" and s.calls == [] and "EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID missing" in said)
s = edge_store(public=v)
r, said = quiet(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check("Edge already has this version: nothing sent", r == "has it" and [c[0] for c in s.calls] == ["GET"])
s = edge_store()
r, said = quiet(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check(f"Edge: upload, wait, publish, wait ({said.strip()})", r == "sent" and [(c[0], c[1].split("prod-1")[-1]) for c in s.calls[1:]] == [
    ("POST", "/submissions/draft/package"), ("GET", "/submissions/draft/package/operations/up-1"),
    ("GET", "/submissions/draft/package/operations/up-1"), ("POST", "/submissions"), ("GET", "/submissions/operations/pub-1")])
up = s.calls[1]
check("Edge: the upload carries the key and client id in v1.1's headers, and the zip", up[2] == {"Authorization": "ApiKey k3y", "X-ClientID": "cid", "Content-Type": "application/zip"} and up[3] == data)
check("Edge: the product's address", up[1] == es.EDGE_API + "prod-1/submissions/draft/package")
pub = s.calls[4]
check("Edge: publishing sends JSON notes for the reviewers", pub[2]["Content-Type"] == "application/json" and json.loads(pub[3])["notes"] == notes)
check("Edge: the key is never printed", "k3y" not in said)
s = edge_store(up_state=ok({"status": "Failed", "errorCode": "InProgressSubmission", "message": "in progress"}))
r, said = quiet(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check(f"Edge: an earlier version still in review is a note, not a failure ({said.strip()})", r == "in review" and "::notice" in said and not any(c[0] == "POST" and c[1].endswith("/submissions") for c in s.calls))
s = edge_store(publish=(409, {}, json.dumps({"errorCode": "InProgressSubmission"})))
r, said = quiet(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check("Edge: …also when publishing says so at once", r == "in review")
s = edge_store(upload=(401, {}, "Unauthorized"))
stopped, said = stops(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check(f"Edge: a refused key stops, saying how to renew it ({said.strip()[:80]}…)", stopped and "72 days" in said and "k3y" not in said)
s = edge_store(up_state=ok({"status": "Failed", "errorCode": "InvalidPackage", "message": "bad zip", "errors": [{"message": "manifest"}]}))
stopped, said = stops(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check(f"Edge: a failed upload stops with Edge's own words ({said.strip()})", stopped and "InvalidPackage bad zip manifest" in said)
s = edge_store(pub_state=ok({"status": "Failed", "errorCode": "NoModulesUpdated", "message": "no updates"}))
stopped, said = stops(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check("Edge: a failed review request stops", stopped and "NoModulesUpdated" in said)
s = edge_store(up_state=ok({"status": "InProgress"}))
stopped, said = stops(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check("Edge: still in progress after 5 minutes stops", stopped and "still in progress" in said and sum(1 for c in s.calls if "up-1" in c[1]) == es.TRIES)
s = Store([("GET", es.EDGE_PUBLIC, (500, {}, "oops"))] + edge_store().rules[1:])
r, _ = quiet(es.edge, data, env=EDGE_ENV, http=s, sleep=nosleep)
check("Edge: the public version unreadable: sends anyway (the store refuses a same version itself)", r == "sent")

# ---- Chrome
CH_ENV = {"GCP_WIF_PROVIDER": "projects/123/locations/global/workloadIdentityPools/gh/providers/thinky",
          "GCP_SERVICE_ACCOUNT": "stores@proj.iam.gserviceaccount.com", "CWS_PUBLISHER_ID": "pub-9",
          "ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.actions.example/x?api-version=2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "ghreq"}
ITEM = f"publishers/pub-9/items/{es.CHROME_STORE_ID}"


def chrome_store(status=None, upload=None, publish=None, sts=None):
    return Store([
        ("GET", "token.actions.example", ok({"value": "github-jwt"})),
        ("POST", "sts.googleapis.com", sts or ok({"access_token": "federated"})),
        ("POST", "iamcredentials.googleapis.com", ok({"accessToken": "cws-token", "expireTime": "x"})),
        ("GET", ":fetchStatus", status or ok({"publishedItemRevisionStatus": {"state": "PUBLISHED", "distributionChannels": [{"crxVersion": older}]}})),
        ("POST", ":upload", upload or ok({"uploadState": "SUCCEEDED", "crxVersion": v})),
        ("POST", ":publish", publish or ok({"state": "PENDING_REVIEW"})),
    ])


s = Store([])
r, said = quiet(es.chrome, data, env={}, http=s)
check("Chrome not set up: skipped, nothing asked", r == "not set up" and s.calls == [])
s = chrome_store()
r, said = quiet(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check(f"Chrome: sign in, read, upload, publish ({said.strip().splitlines()[-1]})", r == "sent" and [c[0] for c in s.calls] == ["GET", "POST", "POST", "GET", "POST", "POST"])
gh_call, sts_call, iam_call, st_call, up_call, pub_call = s.calls
check("Chrome: GitHub's token asked for Google's audience, with the request token",
      gh_call[1] == "https://token.actions.example/x?api-version=2&audience=https%3A%2F%2Fiam.googleapis.com%2F" + CH_ENV["GCP_WIF_PROVIDER"].replace("/", "%2F")
      and gh_call[2] == {"Authorization": "bearer ghreq"})
sts = json.loads(sts_call[3])
check("Chrome: Google's STS gets GitHub's token for the pool's provider", sts["subjectToken"] == "github-jwt" and sts["audience"] == "//iam.googleapis.com/" + CH_ENV["GCP_WIF_PROVIDER"]
      and sts["subjectTokenType"] == "urn:ietf:params:oauth:token-type:jwt")
check("Chrome: the service account's token: Chrome Web Store only, 10 minutes",
      iam_call[1].endswith("/serviceAccounts/stores@proj.iam.gserviceaccount.com:generateAccessToken") and iam_call[2]["Authorization"] == "Bearer federated"
      and json.loads(iam_call[3]) == {"scope": [es.CWS_SCOPE], "lifetime": "600s"})
check("Chrome: v2 addresses for this publisher and item", st_call[1] == es.CWS_API + "v2/" + ITEM + ":fetchStatus" and up_call[1] == es.CWS_API + "upload/v2/" + ITEM + ":upload"
      and pub_call[1] == es.CWS_API + "v2/" + ITEM + ":publish")
check("Chrome: the upload is the zip, with the store token", up_call[3] == data and up_call[2]["Authorization"] == "Bearer cws-token")
check("Chrome: the token is masked in the log and never printed otherwise", "::add-mask::cws-token" in said and said.count("cws-token") == 1)
s = chrome_store(status=ok({"publishedItemRevisionStatus": {"distributionChannels": [{"crxVersion": v}]}}))
r, _ = quiet(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome already has this version: nothing sent", r == "has it" and not any(":upload" in c[1] for c in s.calls))
s = chrome_store(status=ok({"publishedItemRevisionStatus": {"distributionChannels": [{"crxVersion": older}]},
                            "submittedItemRevisionStatus": {"distributionChannels": [{"crxVersion": v}]}}))
r, said = quiet(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check(f"Chrome has this version in review: nothing sent ({said.strip().splitlines()[-1]})", r == "has it" and "(in review)" in said)
s = chrome_store(status=ok({"submittedItemRevisionStatus": {"distributionChannels": [{"crxVersion": older}]}}), upload=(400, {}, "item in review"))
r, said = quiet(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome: an older version in review blocking the upload is a note", r == "in review" and "::notice" in said)
s = chrome_store(upload=(400, {}, "bad package"))
stopped, said = stops(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome: a refused upload (nothing in review) stops", stopped and "bad package" in said)
s = chrome_store(upload=ok({"uploadState": "IN_PROGRESS"}),
                 status=[ok({}), ok({"lastAsyncUploadState": "IN_PROGRESS"}), ok({"lastAsyncUploadState": "SUCCEEDED"})])
r, _ = quiet(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome: an upload in progress is waited for", r == "sent" and sum(1 for c in s.calls if ":fetchStatus" in c[1]) == 3)
s = chrome_store(upload=ok({"uploadState": "FAILED", "itemError": [{"error_detail": "version must be higher"}]}))
stopped, said = stops(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome: a failed upload stops with the store's words", stopped and "version must be higher" in said)
s = chrome_store(sts=(400, {}, "unauthorized_client: attribute condition"))
stopped, said = stops(es.chrome, data, env=CH_ENV, http=s, sleep=nosleep)
check("Chrome: Google refusing this run's sign-in stops with its words", stopped and "attribute condition" in said)
stopped, said = stops(es.chrome, data, env={k: v2 for k, v2 in CH_ENV.items() if not k.startswith("ACTIONS_")}, http=chrome_store(), sleep=nosleep)
check("Chrome: no id-token permission stops, saying so", stopped and "id-token: write" in said)

# ---- the workflow
yml = open(os.path.join(HERE, "..", ".github", "workflows", "stores.yml"), encoding="utf-8").read()
check("stores.yml: after a build on main, or by hand", "workflows: [build]" in yml and "branches: [main]" in yml and "workflow_dispatch" in yml)
check("stores.yml: only after a build that passed, from a push to main", "github.event.workflow_run.conclusion == 'success'" in yml
      and "github.event.workflow_run.head_branch == 'main'" in yml and "github.event.workflow_run.event == 'push'" in yml)
check("stores.yml: the `stores` environment, the sign-in token, read-only contents", "environment: stores" in yml and "id-token: write" in yml and "contents: write" not in yml)
check("stores.yml: the released commit, without keeping git credentials", "github.event.workflow_run.head_sha" in yml and "persist-credentials: false" in yml)
check("stores.yml: never cancelled half way", "cancel-in-progress: false" in yml)
check("stores.yml: Edge's key is the one secret", yml.count("secrets.") == 1 and "secrets.EDGE_API_KEY" in yml)
check("stores.yml: every action pinned to a commit", all("@" in l and len(l.split("@")[1].split()[0]) == 40 for l in yml.splitlines() if "uses:" in l))

# ---- what it's asked
import subprocess
for args in ([], ["zip"], ["edge"], ["publish", "x.zip"]):
    r = subprocess.run([sys.executable, os.path.join(HERE, "extension_store.py"), *args], capture_output=True, text=True)
    check(f"refuses {args}", r.returncode != 0 and "Sends the browser extension" in r.stderr)

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
