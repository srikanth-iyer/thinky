"""Sends the browser extension (browser/) to the Edge and Chrome stores, so a new version needs no
uploading by hand. The `stores` workflow (.github/workflows/stores.yml) runs it after each release:

  extension_store.py zip OUT.zip
      The store package: browser/ without manifest.json's "key" (the stores give their own id; the key
      only fixes the unpacked copy's id), files in a fixed order with a fixed time, so the same files
      always make the same zip. Prints the version.
  extension_store.py edge OUT.zip
      Microsoft Edge Add-ons (its REST API v1.1: upload to the draft, then publish = send for review).
      Needs EDGE_CLIENT_ID, EDGE_API_KEY (Partner Center → Publish API; the key lasts 72 days) and
      EDGE_PRODUCT_ID (the extension's Product ID there). Skipped when the store already has this version.
  extension_store.py chrome OUT.zip
      Chrome Web Store (its API v2: upload, then publish = send for review). No stored password: the
      workflow's GitHub sign-in token is swapped for a short-lived Google one (Workload Identity
      Federation: GCP_WIF_PROVIDER, GCP_SERVICE_ACCOUNT), allowed only to act as the service account
      linked to the publisher (CWS_PUBLISHER_ID). Skipped when the store has this version already, or
      has it waiting for review.

A store that isn't set up yet (its settings missing) is skipped with a note, never a failure. A store
still reviewing an earlier version is a note too: the next release's run tries again. Every other
problem fails the step, with the store's own words. Nothing secret is ever printed.
Tested by scripts/extension_store_test.py (no network); CI's `test` job and pr.yml run it."""
import io, json, os, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))  # this script's folder (scripts/)
sys.path.insert(0, HERE)  # so release_check.py next to it can be imported
from release_check import BROWSER, version_tuple  # browser/ and how versions compare (one rule)

EDGE_STORE_ID = "cpdmmmcipjfebaemgdnbamipolboaokn"  # the extension's id in Edge Add-ons (core clip.rs too)
CHROME_STORE_ID = "ggainimehhgjmblabbjkiemfhhlhcgnk"  # its id in the Chrome Web Store (core clip.rs too)
EDGE_API = "https://api.addons.microsoftedge.microsoft.com/v1/products/"  # Edge's publish API
EDGE_PUBLIC = "https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/"  # what Edge shows people
CWS_API = "https://chromewebstore.googleapis.com/"  # Chrome Web Store API v2
CWS_SCOPE = "https://www.googleapis.com/auth/chromewebstore"  # the one right the Google token gets
FIXED_TIME = (2020, 1, 1, 0, 0, 0)  # every file's time in the zip (the same files → the same zip)
WAIT_S, TRIES = 5, 60  # a store's answer is asked for every 5 s, at most 60 times (5 minutes)


def note(title, msg):
    """A notice in the run's summary (GitHub Actions)."""
    print(f"::notice title={title}::{msg}")


def fail(msg):
    """An error line in the run, and the step fails."""
    print(f"::error::{msg}")
    sys.exit(1)


# ---- the package

def store_manifest(raw):
    """manifest.json for the stores: the same, without "key" (bytes in, bytes out)."""
    m = json.loads(raw.decode("utf-8"))  # the manifest
    m.pop("key", None)  # the stores refuse a package that sets its own id
    return (json.dumps(m, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def make_zip(folder=BROWSER):
    """(the store package's bytes, its version) from the extension's folder."""
    paths = []  # every file's path inside the folder
    for root, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))  # (hidden folders left out)
        for n in names:
            if not n.startswith("."):  # (hidden files left out)
                paths.append(os.path.relpath(os.path.join(root, n), folder).replace(os.sep, "/"))
    if "manifest.json" not in paths:
        fail(f"No manifest.json in {folder}.")
    out = io.BytesIO()  # the zip, in memory (the extension is ~100 KB)
    version = None  # the manifest's version
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(paths):  # a fixed order
            with open(os.path.join(folder, p), "rb") as f:
                data = f.read()
            if p == "manifest.json":
                data = store_manifest(data)  # without "key"
                version = json.loads(data)["version"]
            info = zipfile.ZipInfo(p, date_time=FIXED_TIME)  # a fixed time
            info.external_attr = 0o644 << 16  # plain readable file
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return out.getvalue(), version


def zip_version(data):
    """The version in a store package's manifest.json."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return json.loads(z.read("manifest.json"))["version"]


def certification_notes(data):
    """What Edge's reviewers read with the package: its version and why each permission is there,
    made from the package's own manifest so it never goes out of date."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        m = json.loads(z.read("manifest.json"))
    return (f"thinky highlights {m['version']}, sent by thinky's build pipeline after a release. "
            f"Permissions: {', '.join(m.get('permissions', []))}. Optional host permissions: "
            f"{', '.join(m.get('optional_host_permissions', [])) or 'none'}; asked for only when the user "
            "turns on 'Show my highlights again', to mark passages already saved on pages they come back to. "
            "nativeMessaging talks only to the thinky app on the user's computer (it saves highlights to their "
            "notes); nothing is sent to any server. What changed: https://srikanth-iyer.github.io/thinky/changelog.html")


# ---- talking to the stores

def http(method, url, headers=None, body=None, opener=urllib.request.urlopen):
    """(status, response headers, body as text) for one request; an error status is an answer too
    (its words are what the store says went wrong). A failure to connect stops the step."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with opener(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:  # 4xx / 5xx: the store answered
        return e.code, dict(e.headers or {}), e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as e:  # no answer at all
        fail(f"Couldn't reach {urllib.parse.urlsplit(url).netloc}: {e}")


def as_json(text):
    """The answer read as JSON, or {} when it isn't JSON (an empty body, a web page)."""
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def operation_id(headers):
    """The operation's id from Edge's Location header (its last path part, whatever comes before)."""
    loc = next((v for k, v in headers.items() if k.lower() == "location"), "")  # (any capitals)
    return loc.rstrip("/").split("/")[-1].strip()


def newer(version, than):
    """Is `version` higher than `than`? (no `than` = nothing there yet = yes)"""
    return not than or version_tuple(version) > version_tuple(than)


# ---- Edge

def edge_published_version(http=http):
    """The version Edge Add-ons shows people now ("" when it can't tell)."""
    status, _, text = http("GET", EDGE_PUBLIC + EDGE_STORE_ID)
    return str(as_json(text).get("version", "")) if status == 200 else ""


def edge_wait(url, headers, what, http=http, sleep=time.sleep):
    """Ask an Edge operation's state until it's no longer in progress: its last answer (a dict)."""
    for _ in range(TRIES):
        status, _, text = http("GET", url, headers)
        a = as_json(text)  # {"status": "InProgress" | "Succeeded" | "Failed", "errorCode", "message", "errors"}
        if status >= 400:
            fail(f"Edge: couldn't read the {what}'s state (HTTP {status}): {text[:500]}")
        if a.get("status") != "InProgress":
            return a
        sleep(WAIT_S)
    fail(f"Edge: the {what} was still in progress after {WAIT_S * TRIES} s.")


def edge_problem(a):
    """Edge's own words for a failed operation."""
    errors = "; ".join(str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in (a.get("errors") or []))
    return " ".join(x for x in [a.get("errorCode", ""), a.get("message", ""), errors] if x).strip() or json.dumps(a)


def edge(data, env=os.environ, http=http, sleep=time.sleep):
    """Send the package to Edge Add-ons for review (see the top)."""
    need = ["EDGE_CLIENT_ID", "EDGE_API_KEY", "EDGE_PRODUCT_ID"]
    if not all(env.get(k) for k in need):
        note("Edge", "Not set up yet (" + ", ".join(k for k in need if not env.get(k)) + " missing in the `stores` environment): skipped.")
        return "not set up"
    v = zip_version(data)  # what is being sent
    shown = edge_published_version(http)  # what people get now
    if not newer(v, shown):
        note("Edge", f"Edge Add-ons already has {shown}; this package is {v}: nothing to send.")
        return "has it"
    base = EDGE_API + urllib.parse.quote(env["EDGE_PRODUCT_ID"], safe="")  # this product's address
    auth = {"Authorization": "ApiKey " + env["EDGE_API_KEY"], "X-ClientID": env["EDGE_CLIENT_ID"]}
    # 1. the package into the draft
    status, headers, text = http("POST", base + "/submissions/draft/package", dict(auth, **{"Content-Type": "application/zip"}), data)
    if status == 401 or status == 403:
        fail(f"Edge refused the API key (HTTP {status}). Keys last 72 days: make a new one in Partner Center → Publish API and put it in the `stores` environment's EDGE_API_KEY.")
    if status != 202 and as_json(text).get("errorCode") == "InProgressSubmission":  # (said at once)
        note("Edge", f"An earlier version is still in review, so {v} can't be sent yet; the next release's run tries again.")
        return "in review"
    if status != 202:
        fail(f"Edge: the upload wasn't taken (HTTP {status}): {text[:500]}")
    a = edge_wait(base + "/submissions/draft/package/operations/" + operation_id(headers), auth, "upload", http, sleep)
    if a.get("status") != "Succeeded":
        if a.get("errorCode") == "InProgressSubmission":  # an earlier version is still in review
            note("Edge", f"An earlier version is still in review, so {v} can't be sent yet; the next release's run tries again.")
            return "in review"
        fail(f"Edge: the upload failed: {edge_problem(a)}")
    # 2. publish = send it for review (certification)
    status, headers, text = http("POST", base + "/submissions", dict(auth, **{"Content-Type": "application/json"}),
                                 json.dumps({"notes": certification_notes(data)}).encode("utf-8"))
    if status != 202 and as_json(text).get("errorCode") == "InProgressSubmission":  # (said at once)
        note("Edge", f"An earlier version is still in review, so {v} can't be sent yet; the next release's run tries again.")
        return "in review"
    if status != 202:
        fail(f"Edge: sending {v} for review wasn't taken (HTTP {status}): {text[:500]}")
    a = edge_wait(base + "/submissions/operations/" + operation_id(headers), auth, "submission", http, sleep)
    if a.get("status") != "Succeeded":
        if a.get("errorCode") == "InProgressSubmission":
            note("Edge", f"An earlier version is still in review, so {v} can't be sent yet; the next release's run tries again.")
            return "in review"
        fail(f"Edge: sending {v} for review failed: {edge_problem(a)}")
    note("Edge", f"{v} sent for review (Edge Add-ons had {shown or 'nothing readable'}). Edge says reviews take up to 7 business days; Edge updates people's copies by itself after that.")
    return "sent"


# ---- Chrome

def github_oidc_token(audience, env=os.environ, http=http):
    """GitHub's own short-lived sign-in token for this workflow run (needs `id-token: write`)."""
    url, bearer = env.get("ACTIONS_ID_TOKEN_REQUEST_URL"), env.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url or not bearer:
        fail("Chrome: no GitHub sign-in token (the job needs `permissions: id-token: write`).")
    sep = "&" if "?" in url else "?"  # (GitHub's address already has a query)
    status, _, text = http("GET", url + sep + "audience=" + urllib.parse.quote(audience, safe=""), {"Authorization": "bearer " + bearer})
    token = as_json(text).get("value")
    if status != 200 or not token:
        fail(f"Chrome: GitHub gave no sign-in token (HTTP {status}).")
    return token


def google_token(env=os.environ, http=http):
    """A 10-minute Google access token for the Chrome Web Store, by Workload Identity Federation:
    GitHub's token → Google's STS (a federated token) → the service account's token (chromewebstore only)."""
    provider = env["GCP_WIF_PROVIDER"].strip().strip("/")  # projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>
    jwt = github_oidc_token("https://iam.googleapis.com/" + provider, env, http)
    status, _, text = http("POST", "https://sts.googleapis.com/v1/token", {"Content-Type": "application/json"}, json.dumps({
        "audience": "//iam.googleapis.com/" + provider,
        "grantType": "urn:ietf:params:oauth:grant-type:token-exchange",
        "requestedTokenType": "urn:ietf:params:oauth:token-type:access_token",
        "scope": "https://www.googleapis.com/auth/cloud-platform",
        "subjectTokenType": "urn:ietf:params:oauth:token-type:jwt",
        "subjectToken": jwt}).encode("utf-8"))
    federated = as_json(text).get("access_token")
    if status != 200 or not federated:
        fail(f"Chrome: Google didn't accept this run's GitHub sign-in (HTTP {status}): {text[:500]}")
    sa = urllib.parse.quote(env["GCP_SERVICE_ACCOUNT"].strip(), safe="@.")  # the service account's email
    status, _, text = http("POST", f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa}:generateAccessToken",
                           {"Content-Type": "application/json", "Authorization": "Bearer " + federated},
                           json.dumps({"scope": [CWS_SCOPE], "lifetime": "600s"}).encode("utf-8"))
    token = as_json(text).get("accessToken")
    if status != 200 or not token:
        fail(f"Chrome: couldn't act as {env['GCP_SERVICE_ACCOUNT']} (HTTP {status}): {text[:500]}")
    print(f"::add-mask::{token}")  # (never shown in the log, even by accident)
    return token


def chrome_versions(status_json):
    """(published version, version waiting for review) from fetchStatus's answer ("" when none)."""
    def top(rev):
        vs = [c.get("crxVersion", "") for c in ((status_json.get(rev) or {}).get("distributionChannels") or []) if c.get("crxVersion")]
        return max(vs, key=version_tuple) if vs else ""
    return top("publishedItemRevisionStatus"), top("submittedItemRevisionStatus")


def chrome(data, env=os.environ, http=http, sleep=time.sleep):
    """Send the package to the Chrome Web Store for review (see the top)."""
    need = ["GCP_WIF_PROVIDER", "GCP_SERVICE_ACCOUNT", "CWS_PUBLISHER_ID"]
    if not all(env.get(k) for k in need):
        note("Chrome", "Not set up yet (" + ", ".join(k for k in need if not env.get(k)) + " missing in the `stores` environment): skipped.")
        return "not set up"
    v = zip_version(data)  # what is being sent
    token = google_token(env, http)
    auth = {"Authorization": "Bearer " + token}
    item = CWS_API + "%s/publishers/" + urllib.parse.quote(env["CWS_PUBLISHER_ID"].strip(), safe="") + "/items/" + CHROME_STORE_ID
    status, _, text = http("GET", item % "v2" + ":fetchStatus", auth)
    if status != 200:
        fail(f"Chrome: couldn't read the item's state (HTTP {status}): {text[:500]}")
    published, waiting = chrome_versions(as_json(text))
    if not newer(v, published) or (waiting and not newer(v, waiting)):
        note("Chrome", f"The Chrome Web Store already has {waiting or published}{' (in review)' if waiting and not newer(v, waiting) else ''}; this package is {v}: nothing to send.")
        return "has it"
    # 1. upload (the new package replaces the draft)
    status, _, text = http("POST", item % "upload/v2" + ":upload", dict(auth, **{"Content-Type": "application/zip"}), data)
    a = as_json(text)  # {"uploadState": "SUCCEEDED" | "IN_PROGRESS" | "FAILED" | …, "crxVersion", "itemError"?}
    if status != 200:
        if waiting:  # an earlier version in review can block an upload: try again next time
            note("Chrome", f"{waiting} is still in review and the store didn't take {v} meanwhile (HTTP {status}): {text[:300]}. The next release's run tries again.")
            return "in review"
        fail(f"Chrome: the upload wasn't taken (HTTP {status}): {text[:500]}")
    for _ in range(TRIES):
        state = str(a.get("uploadState", a.get("lastAsyncUploadState", "")))
        if "PROGRESS" not in state:
            break  # finished, one way or the other
        sleep(WAIT_S)
        status, _, text = http("GET", item % "v2" + ":fetchStatus", auth)
        a = as_json(text)
    if not state.startswith("SUCCE"):  # SUCCEEDED (v2; v1 said SUCCESS)
        fail(f"Chrome: the upload failed ({state or 'no state'}): {text[:500]}")
    # 2. publish = send it for review
    status, _, text = http("POST", item % "v2" + ":publish", dict(auth, **{"Content-Type": "application/json"}), b"{}")
    if status != 200:
        fail(f"Chrome: sending {v} for review wasn't taken (HTTP {status}): {text[:500]}")
    note("Chrome", f"{v} sent for review ({as_json(text).get('state', 'state not given')}; it had {published or 'nothing published'}). Chrome updates people's copies by itself after the review.")
    return "sent"


if __name__ == "__main__":  # run as a program
    a = sys.argv[1:]  # what it was asked to do
    if a[:1] == ["zip"] and len(a) == 2:
        data, version = make_zip()
        with open(a[1], "wb") as f:
            f.write(data)
        note("Store package", f"thinky highlights {version}, {len(data):,} bytes")
    elif a[:1] in (["edge"], ["chrome"]) and len(a) == 2:
        with open(a[1], "rb") as f:
            data = f.read()
        (edge if a[0] == "edge" else chrome)(data)
    else:
        sys.exit(__doc__)  # anything else: how to use it, and a failure
