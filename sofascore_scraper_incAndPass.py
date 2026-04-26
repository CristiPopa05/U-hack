#!/usr/bin/env python3
"""
Sofascore Scraper — rating-breakdown per jucător + incidents
=============================================================
Extrage din orice meci:
  1. /event/{id}/incidents
  2. /event/{id}/lineups          → toți player ID-urile
  3. /event/{id}/player/{pid}/rating-breakdown  (pentru FIECARE jucător)

Utilizare:
  python sofascore_scraper.py --match-id 14025035
  python sofascore_scraper.py --team "Real Madrid" --last 5

Instalare:
  pip install undetected-chromedriver selenium
"""

import json
import time
import random
import argparse
from pathlib import Path
from datetime import datetime

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ─── Config ───────────────────────────────────────────────────────────────────
OUTPUT_DIR = Path("./sofascore_output")
OUTPUT_DIR.mkdir(exist_ok=True)

BASE_API = "https://www.sofascore.com/api/v1"


# ─── Browser ──────────────────────────────────────────────────────────────────

def make_driver(headless: bool = False) -> uc.Chrome:
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1440,900")
    options.add_argument("--lang=en-US")

    driver_path = Path(__file__).parent / "chromedriver.exe"
    if driver_path.exists():
        return uc.Chrome(
            options=options,
            driver_executable_path=str(driver_path),
            version_main=147,
            use_subprocess=True,
        )
    return uc.Chrome(options=options, use_subprocess=True)


# ─── Fetch helper ─────────────────────────────────────────────────────────────

def fetch_json(driver: uc.Chrome, url: str, retries: int = 3) -> dict | None:
    for attempt in range(retries):
        try:
            driver.get(url)
            WebDriverWait(driver, 12).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            time.sleep(random.uniform(0.6, 1.2))

            # Metodă 1: <pre>
            try:
                pre = driver.find_element(By.TAG_NAME, "pre")
                text = pre.text.strip()
                if text.startswith("{"):
                    return json.loads(text)
            except Exception:
                pass

            # Metodă 2: <body>
            body = driver.find_element(By.TAG_NAME, "body").text.strip()
            if body.startswith("{"):
                return json.loads(body)

            # Metodă 3: JS innerText
            src = driver.execute_script("return document.documentElement.innerText")
            if src and src.strip().startswith("{"):
                return json.loads(src.strip())

            print(f"  ⚠  Ne-JSON (attempt {attempt + 1}): {url}")
            time.sleep(3)

        except json.JSONDecodeError as e:
            print(f"  ⚠  JSON invalid (attempt {attempt + 1}): {e}")
            time.sleep(3)
        except Exception as e:
            print(f"  ⚠  Eroare (attempt {attempt + 1}): {e}")
            time.sleep(3)

    return None


def polite_sleep(min_s=2.0, max_s=4.0):
    time.sleep(random.uniform(min_s, max_s))


def warm_up(driver: uc.Chrome):
    print("🌐 Warm-up sesiune...")
    driver.get("https://www.sofascore.com")
    time.sleep(random.uniform(4, 6))
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight / 3)")
    time.sleep(random.uniform(1, 2))


# ─── Core fetchers ────────────────────────────────────────────────────────────

def get_incidents(driver: uc.Chrome, match_id: int) -> dict | None:
    print(f"  📡 incidents...")
    url = f"{BASE_API}/event/{match_id}/incidents"
    data = fetch_json(driver, url)
    polite_sleep()
    if data:
        n = len(data.get("incidents", []))
        print(f"  ✅ incidents: {n} evenimente")
    else:
        print(f"  ❌ incidents: eșec")
    return data


def get_lineups(driver: uc.Chrome, match_id: int) -> dict | None:
    print(f"  📡 lineups...")
    data = fetch_json(driver, f"{BASE_API}/event/{match_id}/lineups")
    polite_sleep()
    return data


def extract_players_from_lineups(lineups: dict) -> list[dict]:
    """
    Returnează lista de jucători cu id, name, team, side, position.
    Funcționează atât cu structura home/away cât și cu confirmed/unconfirmed.
    """
    players = []
    if not lineups:
        return players

    for side in ("home", "away"):
        team_data = lineups.get(side, {})
        team_name = team_data.get("team", {}).get("name", side)

        # Structură standard: players[]
        for p in team_data.get("players", []):
            player = p.get("player", {})
            pid = player.get("id")
            if not pid:
                continue
            players.append({
                "id": pid,
                "name": player.get("name", "?"),
                "team": team_name,
                "side": side,
                "position": p.get("position", ""),
                "shirtNumber": p.get("shirtNumber"),
                "substitute": p.get("substitute", False),
                "captain": p.get("captain", False),
            })

        # Structură alternativă: confirmed[] sau unconfirmed[]
        for key in ("confirmed", "unconfirmed"):
            for p in team_data.get(key, []):
                player = p.get("player", {})
                pid = player.get("id")
                if not pid or any(x["id"] == pid for x in players):
                    continue
                players.append({
                    "id": pid,
                    "name": player.get("name", "?"),
                    "team": team_name,
                    "side": side,
                    "position": p.get("position", ""),
                    "shirtNumber": p.get("shirtNumber"),
                    "substitute": p.get("substitute", False),
                    "captain": p.get("captain", False),
                })

    return players


def get_rating_breakdown(driver: uc.Chrome, match_id: int, player: dict) -> dict | None:
    url = f"{BASE_API}/event/{match_id}/player/{player['id']}/rating-breakdown"
    data = fetch_json(driver, url)
    # Delay scurt între jucători — nu vrem ban
    polite_sleep(1.5, 3.0)
    return data


# ─── Match scraper ────────────────────────────────────────────────────────────

def scrape_match(driver: uc.Chrome, match_id: int) -> dict:
    print(f"\n{'─'*55}")
    print(f"⚽ Meci ID: {match_id}")

    # Info de bază
    info_data = fetch_json(driver, f"{BASE_API}/event/{match_id}") or {}
    info = info_data.get("event", info_data)
    polite_sleep()

    if info:
        home = info.get("homeTeam", {}).get("name", "?")
        away = info.get("awayTeam", {}).get("name", "?")
        ts   = info.get("startTimestamp", 0)
        dt   = datetime.fromtimestamp(ts).strftime("%d.%m.%Y %H:%M") if ts else "?"
        hs   = info.get("homeScore", {}).get("current", "?")
        as_  = info.get("awayScore", {}).get("current", "?")
        print(f"   {home} {hs}–{as_} {away}  ({dt})")

    # 1. Incidents
    incidents = get_incidents(driver, match_id)

    # 2. Lineups → extrage jucători
    lineups = get_lineups(driver, match_id)
    players = extract_players_from_lineups(lineups)
    print(f"  👥 {len(players)} jucători găsiți în lineups")

    # 3. Rating breakdown per jucător
    rating_breakdowns = {}
    if players:
        print(f"  📊 Extrag rating-breakdown pentru fiecare jucător...")
        for i, p in enumerate(players, 1):
            print(f"     [{i}/{len(players)}] {p['name']} (ID: {p['id']})...", end=" ")
            rb = get_rating_breakdown(driver, match_id, p)
            if rb:
                rating_breakdowns[p["id"]] = {
                    "playerInfo": p,
                    "ratingBreakdown": rb,
                }
                print("✅")
            else:
                rating_breakdowns[p["id"]] = {
                    "playerInfo": p,
                    "ratingBreakdown": None,
                }
                print("❌")
    else:
        print("  ⚠  Nu s-au găsit jucători în lineups — meciul poate fi prea vechi sau fără date.")

    # Asamblare rezultat final
    combined = {
        "matchId":        match_id,
        "matchInfo":      info,
        "incidents":      incidents,
        "lineups":        lineups,
        "ratingBreakdowns": rating_breakdowns,
        "scrapedAt":      datetime.now().isoformat(),
    }

    # Salvare
    if incidents:
        save(incidents, f"incidents_{match_id}.json")
    if rating_breakdowns:
        save(rating_breakdowns, f"rating_breakdowns_{match_id}.json")
    save(combined, f"combined_{match_id}.json")

    return combined


# ─── Team helpers ─────────────────────────────────────────────────────────────

def search_team(driver: uc.Chrome, name: str) -> dict | None:
    print(f"\n🔎 Caut echipa: '{name}'...")
    data = fetch_json(driver, f"{BASE_API}/search/all?q={name.replace(' ', '+')}&page=0")
    polite_sleep()
    if not data:
        return None
    for r in data.get("results", []):
        if r.get("type") == "team":
            t = r.get("entity", {})
            print(f"  ✅ Găsit: {t.get('name')} (ID: {t.get('id')})")
            return t
    print(f"  ❌ '{name}' nu a fost găsit.")
    return None


def get_last_events(driver: uc.Chrome, team_id: int, last: int = 5) -> list:
    data = fetch_json(driver, f"{BASE_API}/team/{team_id}/events/last/0")
    polite_sleep()
    if not data:
        return []
    events = sorted(
        data.get("events", []),
        key=lambda e: e.get("startTimestamp", 0),
        reverse=True
    )
    selected = events[:last]
    print(f"\n  📅 Ultimele {len(selected)} meciuri:")
    for e in selected:
        home = e.get("homeTeam", {}).get("name", "?")
        away = e.get("awayTeam", {}).get("name", "?")
        ts   = e.get("startTimestamp", 0)
        dt   = datetime.fromtimestamp(ts).strftime("%d.%m.%Y") if ts else "?"
        hs   = e.get("homeScore", {}).get("current", "?")
        as_  = e.get("awayScore", {}).get("current", "?")
        print(f"    [{e['id']}] {dt}  {home} {hs}–{as_} {away}")
    return selected


# ─── Save ─────────────────────────────────────────────────────────────────────

def save(data, filename: str) -> Path:
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = path.stat().st_size / 1024
    print(f"  💾 Salvat: {path}  ({size_kb:.1f} KB)")
    return path


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Sofascore — incidents + rating-breakdown per jucător",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemple:
  python sofascore_scraper.py --match-id 14025035
  python sofascore_scraper.py --team "Real Madrid" --last 5
  python sofascore_scraper.py --match-id 11111111 22222222
  python sofascore_scraper.py --headless --team "Barcelona" --last 3
        """
    )
    parser.add_argument("--match-id",   nargs="+", type=int, help="ID(uri) meci Sofascore")
    parser.add_argument("--team",       type=str,            help="Nume echipă")
    parser.add_argument("--last",       type=int, default=5, help="Câte meciuri (default: 5)")
    parser.add_argument("--headless",   action="store_true", help="Browser fără fereastră")
    parser.add_argument("--output-dir", type=str, default="./sofascore_output")
    args = parser.parse_args()

    global OUTPUT_DIR
    OUTPUT_DIR = Path(args.output_dir)
    OUTPUT_DIR.mkdir(exist_ok=True)

    match_ids = list(args.match_id or [])

    driver = make_driver(headless=args.headless)
    try:
        warm_up(driver)

        if args.team:
            team = search_team(driver, args.team)
            if team:
                events = get_last_events(driver, team["id"], args.last)
                match_ids.extend(e["id"] for e in events)

        if not match_ids:
            parser.print_help()
            return

        match_ids = list(dict.fromkeys(match_ids))
        print(f"\n🚀 Procesez {len(match_ids)} meci(uri)...\n")

        all_results = []
        for i, mid in enumerate(match_ids):
            result = scrape_match(driver, mid)
            all_results.append(result)
            if i < len(match_ids) - 1:
                polite_sleep(3, 6)

        if len(all_results) > 1:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            save(all_results, f"all_matches_{ts}.json")

    finally:
        try:
            driver.quit()
        except Exception:
            pass

    print(f"\n✅ Gata! Fișierele sunt în: {OUTPUT_DIR.resolve()}")
    print(f"   incidents_<id>.json           → goluri + footballPassingNetworkAction")
    print(f"   rating_breakdowns_<id>.json   → rating-breakdown pentru fiecare jucător")
    print(f"   combined_<id>.json            → tot împreună")


if __name__ == "__main__":
    main()
