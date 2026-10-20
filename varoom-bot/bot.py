import os
import json
import requests
import asyncio
import threading
import schedule
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, Bot
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler, CallbackQueryHandler
import anthropic
from supabase import create_client


TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

ALLOWED_USERS = [8550157460, 8775030085]
SUMMARY_USER_ID = 8550157460  # Rowan gets the daily summary

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

conversations = {}
pending_events = {}

CHATTING = 1

# ─── Utility ──────────────────────────────────────────────────

def is_allowed(user_id):
    return user_id in ALLOWED_USERS

def scrape_url(url):
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:8000]
    except Exception as e:
        return f"Could not scrape: {e}"

def extract_page_image(url):
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            return og_image["content"]
        twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
        if twitter_image and twitter_image.get("content"):
            return twitter_image["content"]
        for img in soup.find_all("img"):
            src = img.get("src", "")
            if src and not src.endswith(".svg") and "logo" not in src.lower() and "icon" not in src.lower():
                if src.startswith("http"):
                    return src
                elif src.startswith("/"):
                    parsed = urlparse(url)
                    return f"{parsed.scheme}://{parsed.netloc}{src}"
        return None
    except:
        return None

def find_urls_from_search(query):
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        urls = []
        for result in soup.select(".result__a")[:8]:
            href = result.get("href", "")
            if href.startswith("http") and not any(skip in href for skip in ["duckduckgo", "google", "bing", "facebook", "twitter", "youtube", "wikipedia"]):
                urls.append(href)
        return urls[:6]
    except:
        return []

def geocode_location(location):
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={requests.utils.quote(location)}&format=json&limit=1&countrycodes=gb"
        headers = {"User-Agent": "VaroomBot/1.0"}
        response = requests.get(url, headers=headers, timeout=5)
        data = response.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except:
        pass
    return None, None

# ─── Database helpers ──────────────────────────────────────────

def get_existing_titles():
    result = supabase.table("events").select("title, date").execute()
    return [(e["title"].lower().strip(), e.get("date", "")) for e in (result.data or [])]

def get_existing_urls():
    result = supabase.table("scrape_sources").select("url").execute()
    return [r["url"].lower() for r in (result.data or [])]

def get_active_sources():
    result = supabase.table("scrape_sources").select("*").eq("is_active", True).execute()
    return result.data or []

def get_recent_events():
    result = supabase.table("events").select("id, title, date, event_type, location_name, start_time, vehicle_type, marque, is_recurring, recurrence, description, external_link, latitude, longitude, address, is_verified").order("created_at", desc=True).limit(50).execute()
    return result.data or []

def search_events(query):
    result = supabase.table("events").select("id, title, date, event_type, location_name, start_time, vehicle_type, marque, is_recurring, recurrence, description, external_link, latitude, longitude, address, is_verified").ilike("title", f"%{query}%").execute()
    return result.data or []

def save_event(event_data, lat, lng, source_url=None):
    insert_data = {
        "title": event_data.get("title"),
        "date": event_data.get("date"),
        "start_time": event_data.get("start_time"),
        "location_name": event_data.get("location_name"),
        "address": event_data.get("address"),
        "description": event_data.get("description"),
        "event_type": event_data.get("event_type"),
        "vehicle_type": event_data.get("vehicle_type"),
        "external_link": event_data.get("external_link"),
        "marque": event_data.get("marque"),
        "is_recurring": event_data.get("is_recurring", False),
        "recurrence": event_data.get("recurrence"),
        "latitude": lat,
        "longitude": lng,
        "is_approved": True,
        "is_verified": False,
        "source_url": source_url
    }
    supabase.table("events").insert(insert_data).execute()

def add_source(url, vehicle_hint=None, type_hint=None, area_hint=None):
    supabase.table("scrape_sources").insert({
        "url": url,
        "vehicle_hint": vehicle_hint,
        "type_hint": type_hint,
        "area_hint": area_hint,
        "is_active": True,
        "fail_count": 0
    }).execute()

def mark_source_scraped(source_id):
    supabase.table("scrape_sources").update({
        "last_scraped": datetime.now(timezone.utc).isoformat(),
        "fail_count": 0
    }).eq("id", source_id).execute()

def mark_source_failed(source_id, current_fail_count):
    new_count = current_fail_count + 1
    update = {"fail_count": new_count}
    if new_count >= 3:
        update["is_active"] = False
    supabase.table("scrape_sources").update(update).eq("id", source_id).execute()
    return new_count >= 3

# ─── Event extraction ──────────────────────────────────────────

def extract_multiple_events(page_content, source_url, vehicle_hint=None, type_hint=None, area_hint=None):
    hint_text = ""
    if vehicle_hint:
        hint_text += f"\nVehicle hint: This site is primarily about {vehicle_hint} events."
    if type_hint:
        hint_text += f"\nEvent type hint: Events here are likely {type_hint}."
    if area_hint:
        hint_text += f"\nArea hint: This site covers events in {area_hint}."

    prompt = f"""You are extracting car and motorbike events from a UK website for the Varoom events app.

Source URL: {source_url}{hint_text}

Page content:
{page_content}

Extract ALL car/motorbike events you can find. Return a JSON array. If none found, return [].

Each event must have:
- title: string
- date: YYYY-MM-DD (skip event entirely if no date)
- start_time: HH:MM:SS or null
- location_name: venue name
- address: full address if available
- description: max 200 chars
- event_type: meets/auctions/races/autojumbles
- vehicle_type: car/motorbike/both
- external_link: source URL
- marque: brand if specific, else null
- is_recurring: true/false
- recurrence: description if recurring else null

Only UK events. Only include if title AND location exist.
Return ONLY the JSON array."""

    try:
        response = claude.messages.create(
            model="claude-opus-4-5",
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        if text.endswith("```"):
            text = text[:-3]
        events = json.loads(text.strip())
        return events if isinstance(events, list) else []
    except:
        return []

def discover_new_sources(events_found, existing_urls):
    """Search for new scrape sources based on found events"""
    new_sources = []
    search_queries = set()

    for event in events_found[:5]:
        location = event.get("location_name", "")
        event_type = event.get("event_type", "")
        vehicle = event.get("vehicle_type", "")
        if location:
            search_queries.add(f"{event_type} events {location} UK 2026 calendar")
        if vehicle == "motorbike":
            search_queries.add("motorbike motorcycle events UK 2026 calendar")

    # Also add some broad weekly discovery searches
    search_queries.add("classic car shows UK 2026 2027 events calendar")
    search_queries.add("UK autojumble schedule 2026 2027")
    search_queries.add("motorsport track days UK 2026 events")

    for query in list(search_queries)[:4]:
        urls = find_urls_from_search(query)
        for url in urls:
            if url.lower() not in existing_urls and url not in [s["url"] for s in new_sources]:
                # Guess hints from URL/query
                vehicle_hint = "motorbike" if "motorbike" in query or "motorcycle" in query else None
                type_hint = "autojumble" if "autojumble" in query else None
                new_sources.append({
                    "url": url,
                    "vehicle_hint": vehicle_hint,
                    "type_hint": type_hint,
                    "area_hint": None
                })

    return new_sources[:10]

def verify_event(event_title, event_date, event_location):
    query = f"{event_title} {event_date[:4] if event_date else ''} UK"
    urls = find_urls_from_search(query)
    if not urls:
        return False, "No results found"
    for url in urls[:2]:
        content = scrape_url(url)
        if event_title.lower()[:20] in content.lower():
            return True, f"Confirmed on: {url[:60]}"
    return False, "Could not confirm on second source"

# ─── Auto scraper ──────────────────────────────────────────────

def run_auto_scrape():
    """Main auto-scrape function — runs on schedule"""
    print(f"[{datetime.now()}] Starting auto-scrape...")

    sources = get_active_sources()
    if not sources:
        print("No active sources to scrape.")
        return

    existing = get_existing_titles()
    existing_titles = [t[0] for t in existing]
    existing_urls = get_existing_urls()

    total_saved = 0
    total_skipped = 0
    failed_sources = []
    all_new_events = []

    for source in sources:
        url = source["url"]
        source_id = source["id"]
        fail_count = source.get("fail_count", 0)

        print(f"Scraping: {url[:60]}")
        content = scrape_url(url)

        if "Could not scrape" in content:
            deactivated = mark_source_failed(source_id, fail_count)
            failed_sources.append({"url": url, "deactivated": deactivated})
            continue

        events = extract_multiple_events(
            content, url,
            vehicle_hint=source.get("vehicle_hint"),
            type_hint=source.get("type_hint"),
            area_hint=source.get("area_hint")
        )

        new_events = [e for e in events if e.get("title", "").lower().strip() not in existing_titles and e.get("date")]
        dupes = len(events) - len(new_events)
        total_skipped += dupes

        for event in new_events:
            location = event.get("address") or event.get("location_name", "")
            lat, lng = geocode_location(location)
            try:
                save_event(event, lat, lng, source_url=url)
                existing_titles.append(event["title"].lower().strip())
                total_saved += 1
                all_new_events.append(event)
            except Exception as e:
                print(f"Failed to save event: {e}")

        mark_source_scraped(source_id)

    # Discover new sources
    new_sources_added = []
    if all_new_events:
        new_sources = discover_new_sources(all_new_events, existing_urls)
        for ns in new_sources:
            try:
                add_source(ns["url"], ns.get("vehicle_hint"), ns.get("type_hint"), ns.get("area_hint"))
                new_sources_added.append(ns["url"])
                existing_urls.append(ns["url"].lower())
                print(f"Added new source: {ns['url'][:60]}")
            except:
                pass

    # Send summary to Telegram
    summary = build_summary(
        sources_scraped=len(sources),
        total_saved=total_saved,
        total_skipped=total_skipped,
        failed_sources=failed_sources,
        new_sources=new_sources_added,
        sample_events=all_new_events[:5]
    )

    send_telegram_message(SUMMARY_USER_ID, summary)
    print(f"[{datetime.now()}] Auto-scrape complete. Saved: {total_saved}, Skipped: {total_skipped}")

def build_summary(sources_scraped, total_saved, total_skipped, failed_sources, new_sources, sample_events):
    lines = [
        f"🚗 Varoom Auto-Scrape Summary",
        f"📅 {datetime.now().strftime('%d %b %Y %H:%M')}",
        f"",
        f"✅ {total_saved} new events saved",
        f"⏭ {total_skipped} duplicates skipped",
        f"🔍 {sources_scraped} sources scraped",
    ]

    if new_sources:
        lines.append(f"🌐 {len(new_sources)} new sources discovered")

    if failed_sources:
        lines.append(f"")
        lines.append(f"⚠️ Failed sources:")
        for fs in failed_sources:
            status = " (deactivated after 3 fails)" if fs["deactivated"] else ""
            lines.append(f"  • {fs['url'][:50]}{status}")

    if sample_events:
        lines.append(f"")
        lines.append(f"📌 Sample new events:")
        for e in sample_events:
            lines.append(f"  • {e.get('title', '?')} — {e.get('date', '?')}")

    return "\n".join(lines)

def send_telegram_message(user_id, text):
    """Send a message via Telegram Bot API directly"""
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        requests.post(url, json={"chat_id": user_id, "text": text}, timeout=10)
    except Exception as e:
        print(f"Failed to send Telegram message: {e}")

# ─── Scheduler ────────────────────────────────────────────────

def start_scheduler():
    """Run the scheduler in a background thread"""
    schedule.every(6).hours.do(run_auto_scrape)
    schedule.every().day.at("08:00").do(run_auto_scrape)  # Daily morning run

    def run():
        while True:
            schedule.run_pending()
            time.sleep(60)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    print("Scheduler started — auto-scrape every 6 hours.")

# ─── Bot commands ──────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    conversations[update.message.from_user.id] = []
    await update.message.reply_text(
        "Hey! VaroomBot here 🚗\n\n"
        "Auto-scraper is running every 6 hours.\n\n"
        "Source management:\n"
        "/addsource <url> [vehicle] [type] [area]\n"
        "/listsources — view all sources\n"
        "/removesource <id> — remove a source\n"
        "/runscrape — run scraper now\n"
        "/scrapestat — last run stats\n\n"
        "Event management:\n"
        "/list — recent events\n"
        "/verify <id> — verify an event\n"
        "/setverified <id> — manually verify\n"
        "/setimage <id> <url> — set featured image\n\n"
        "Discovery:\n"
        "/scan — scrape URLs you paste\n"
        "/hunt <term> — search and scrape\n"
        "/cancel — start over"
    )

async def addsource_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text(
            "Usage: /addsource <url> [vehicle_hint] [type_hint] [area_hint]\n\n"
            "Examples:\n"
            "/addsource https://scooterworld.co.uk motorbike\n"
            "/addsource https://goodwood.com/events car races\n"
            "/addsource https://walesmotorcycle.co.uk motorbike meets Wales"
        )
        return
    url = args[0]
    vehicle_hint = args[1] if len(args) > 1 else None
    type_hint = args[2] if len(args) > 2 else None
    area_hint = args[3] if len(args) > 3 else None

    existing = get_existing_urls()
    if url.lower() in existing:
        await update.message.reply_text(f"⚠️ {url} is already in the source list.")
        return

    try:
        add_source(url, vehicle_hint, type_hint, area_hint)
        await update.message.reply_text(
            f"✅ Added source:\n{url}\n"
            f"Vehicle: {vehicle_hint or 'auto-detect'}\n"
            f"Type: {type_hint or 'auto-detect'}\n"
            f"Area: {area_hint or 'auto-detect'}"
        )
    except Exception as e:
        await update.message.reply_text(f"❌ Failed: {e}")

async def listsources_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    try:
        result = supabase.table("scrape_sources").select("*").order("id").execute()
        sources = result.data or []
        if not sources:
            await update.message.reply_text("No sources yet. Use /addsource to add one.")
            return
        msg = f"📋 Scrape Sources ({len(sources)} total):\n\n"
        for s in sources:
            status = "✅" if s.get("is_active") else "❌"
            last = s.get("last_scraped", "never")
            if last and last != "never":
                last = last[:10]
            hints = []
            if s.get("vehicle_hint"): hints.append(s["vehicle_hint"])
            if s.get("type_hint"): hints.append(s["type_hint"])
            if s.get("area_hint"): hints.append(s["area_hint"])
            hint_str = f" [{', '.join(hints)}]" if hints else ""
            msg += f"{status} ID:{s['id']} | {s['url'][:45]}...{hint_str}\n   Last: {last} | Fails: {s.get('fail_count', 0)}\n\n"
        await update.message.reply_text(msg)
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def removesource_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text("Usage: /removesource <id>")
        return
    try:
        supabase.table("scrape_sources").delete().eq("id", args[0]).execute()
        await update.message.reply_text(f"✅ Source {args[0]} removed.")
    except Exception as e:
        await update.message.reply_text(f"❌ Failed: {e}")

async def runscrape_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    sources = get_active_sources()
    await update.message.reply_text(f"🔄 Starting manual scrape of {len(sources)} sources...\nI'll send you a summary when done.")
    threading.Thread(target=run_auto_scrape, daemon=True).start()

async def scrapestat_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    try:
        sources = supabase.table("scrape_sources").select("*").execute().data or []
        active = [s for s in sources if s.get("is_active")]
        inactive = [s for s in sources if not s.get("is_active")]
        last_scraped = [s.get("last_scraped") for s in sources if s.get("last_scraped")]
        most_recent = max(last_scraped)[:16] if last_scraped else "never"

        event_count = supabase.table("events").select("id", count="exact").execute().count

        msg = (
            f"📊 Varoom Scrape Stats\n\n"
            f"Total sources: {len(sources)}\n"
            f"Active: {len(active)}\n"
            f"Inactive (failed): {len(inactive)}\n"
            f"Last scrape: {most_recent}\n"
            f"Total events in DB: {event_count}"
        )
        await update.message.reply_text(msg)
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def list_events(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    try:
        events = get_recent_events()
        if not events:
            await update.message.reply_text("No events found.")
            return
        msg = "Recent Events:\n\n"
        for e in events[:15]:
            verified = " ✅" if e.get("is_verified") else ""
            recurring = " 🔄" if e.get("is_recurring") else ""
            msg += f"ID:{e['id']} | {e['date']} | {e['title']}{verified}{recurring}\n"
        msg += "\nTell me which one to edit or delete!"
        await update.message.reply_text(msg)
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def verify_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text("Usage: /verify <event_id>")
        return
    try:
        result = supabase.table("events").select("*").eq("id", args[0]).execute()
        if not result.data:
            await update.message.reply_text("Event not found.")
            return
        event = result.data[0]
        await update.message.reply_text(f"🔍 Verifying: {event['title']}...")
        confirmed, message = verify_event(event['title'], event.get('date', ''), event.get('location_name', ''))
        if confirmed:
            supabase.table("events").update({"is_verified": True}).eq("id", args[0]).execute()
            await update.message.reply_text(f"✅ Verified! {message}")
        else:
            await update.message.reply_text(f"⚠️ Could not auto-verify.\n{message}\nUse /setverified {args[0]} to manually verify.")
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def setverified_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text("Usage: /setverified <event_id>")
        return
    try:
        supabase.table("events").update({"is_verified": True}).eq("id", args[0]).execute()
        await update.message.reply_text(f"✅ Event {args[0]} marked as verified.")
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def setimage_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if len(args) < 2:
        await update.message.reply_text("Usage: /setimage <featured_listing_id> <image_url>")
        return
    try:
        supabase.table("featured_listings").update({"image_url": args[1]}).eq("id", args[0]).execute()
        await update.message.reply_text(f"✅ Image updated for listing {args[0]}")
    except Exception as e:
        await update.message.reply_text(f"❌ Failed: {e}")

async def scan_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    await update.message.reply_text("Send me URLs to scan, one per line.")
    context.user_data["awaiting_scan_urls"] = True

async def hunt_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text("Usage: /hunt classic car shows UK 2026")
        return
    query = " ".join(args)
    await update.message.reply_text(f"🔍 Hunting for: {query}\nSearching...")
    urls = find_urls_from_search(query + " UK events 2026")
    if not urls:
        await update.message.reply_text("No URLs found. Try a different term.")
        return
    await update.message.reply_text(f"Found {len(urls)} sites. Scraping...")
    await process_urls(update, context, urls, update.message.from_user.id)

async def process_urls(update, context, urls, user_id):
    existing = get_existing_titles()
    existing_titles = [t[0] for t in existing]
    all_found = []

    for i, url in enumerate(urls):
        await update.message.reply_text(f"Scraping {i+1}/{len(urls)}: {url[:60]}...")
        content = scrape_url(url)
        if "Could not scrape" in content:
            await update.message.reply_text(f"⚠️ Couldn't scrape {url[:60]}")
            continue
        events = extract_multiple_events(content, url)
        image = extract_page_image(url)
        new_events = [e for e in events if e.get("title", "").lower().strip() not in existing_titles]
        dupes = len(events) - len(new_events)
        msg = f"✅ Found {len(events)} events"
        if dupes: msg += f" ({dupes} already in DB)"
        if image: msg += f"\n🖼 Image found"
        await update.message.reply_text(msg)
        all_found.extend(new_events)

    if not all_found:
        await update.message.reply_text("No new events found.")
        return

    await update.message.reply_text(f"Found {len(all_found)} new events. Showing for approval...")
    pending_events[user_id] = all_found
    context.user_data["pending_index"] = 0
    await show_pending_event(update, context, user_id)

async def show_pending_event(update, context, user_id):
    events = pending_events.get(user_id, [])
    index = context.user_data.get("pending_index", 0)
    if index >= len(events):
        await update.message.reply_text("All done! Use /list to see the database.")
        pending_events.pop(user_id, None)
        return
    event = events[index]
    verified = " ✅" if event.get("is_verified") else ""
    lines = [
        f"Event {index + 1}/{len(events)}{verified}",
        f"📌 {event.get('title', '?')}",
        f"📅 {event.get('date', '?')}",
        f"📍 {event.get('location_name', '?')}",
        f"🏷 {event.get('event_type', '?')} | {event.get('vehicle_type', '?')}",
    ]
    if event.get("marque"): lines.append(f"🚗 {event['marque']}")
    if event.get("description"): lines.append(f"📝 {event['description'][:100]}")

    keyboard = [
        [InlineKeyboardButton("✅ Save", callback_data=f"save_{index}"),
         InlineKeyboardButton("⏭ Skip", callback_data=f"skip_{index}")],
        [InlineKeyboardButton("💾 Save All", callback_data="save_all"),
         InlineKeyboardButton("❌ Stop", callback_data="stop_review")]
    ]
    await update.message.reply_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(keyboard))

async def handle_approval_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    if not is_allowed(user_id):
        return
    data = query.data
    events = pending_events.get(user_id, [])
    index = context.user_data.get("pending_index", 0)

    if data.startswith("save_"):
        event = events[index]
        location = event.get("address") or event.get("location_name", "")
        lat, lng = geocode_location(location)
        try:
            save_event(event, lat, lng)
            await query.edit_message_text(f"✅ Saved: {event.get('title')}")
        except Exception as e:
            await query.edit_message_text(f"❌ Failed: {e}")
        context.user_data["pending_index"] = index + 1
        await show_pending_event(update.callback_query, context, user_id)

    elif data.startswith("skip_"):
        await query.edit_message_text(f"⏭ Skipped: {events[index].get('title')}")
        context.user_data["pending_index"] = index + 1
        await show_pending_event(update.callback_query, context, user_id)

    elif data == "save_all":
        remaining = events[index:]
        saved = 0
        for event in remaining:
            location = event.get("address") or event.get("location_name", "")
            lat, lng = geocode_location(location)
            try:
                save_event(event, lat, lng)
                saved += 1
            except:
                pass
        await query.edit_message_text(f"💾 Saved {saved} events!")
        pending_events.pop(user_id, None)

    elif data == "stop_review":
        await query.edit_message_text(f"❌ Stopped.")
        pending_events.pop(user_id, None)

def chat_with_claude(conversation_history, user_message, scraped_content=None, events_context=None):
    system_prompt = """You are VaroomBot, admin assistant for Varoom (varoom.app) - UK car and motorbike events app.

ADDING EVENTS:
SAVE_EVENT:{"title":"...","date":"...","start_time":"...","location_name":"...","address":"...","description":"...","event_type":"...","vehicle_type":"...","external_link":null,"marque":null,"is_recurring":false,"recurrence":null}

EDITING:
UPDATE_EVENT:{"id":123,"field":"value"}

DELETING:
DELETE_EVENT:{"id":123}

Be concise. If user says "save it" — save it. You ARE the Varoom team."""

    messages = conversation_history.copy()
    content = user_message
    if scraped_content:
        content = f"Scraped:\n{scraped_content}\n\nUser: {user_message}"
    if events_context:
        content = f"Events:\n{events_context}\n\nUser: {user_message}"
    messages.append({"role": "user", "content": content})

    response = claude.messages.create(
        model="claude-opus-4-5",
        max_tokens=1000,
        system=system_prompt,
        messages=messages
    )
    reply = response.content[0].text
    messages.append({"role": "assistant", "content": reply})
    return reply, messages

def extract_command(text, command):
    if command in text:
        try:
            json_str = text.split(command)[1].strip()
            if "\n" in json_str:
                json_str = json_str.split("\n")[0]
            return json.loads(json_str)
        except:
            return None
    return None

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    user_id = update.message.from_user.id
    message_text = update.message.text
    if user_id not in conversations:
        conversations[user_id] = []

    if context.user_data.get("awaiting_scan_urls"):
        context.user_data["awaiting_scan_urls"] = False
        lines = message_text.strip().split("\n")
        urls = [l.strip() for l in lines if l.strip().startswith("http")]
        if not urls:
            await update.message.reply_text("No valid URLs found.")
            return
        await update.message.reply_text(f"Got {len(urls)} URLs. Scraping...")
        await process_urls(update, context, urls, user_id)
        return

    scraped_content = None
    events_context = None

    if message_text.startswith("http"):
        await update.message.reply_text("Fetching...")
        scraped_content = scrape_url(message_text)
        events = extract_multiple_events(scraped_content, message_text)
        if events:
            existing = get_existing_titles()
            existing_titles = [t[0] for t in existing]
            new_events = [e for e in events if e.get("title", "").lower().strip() not in existing_titles]
            if new_events:
                await update.message.reply_text(f"Found {len(new_events)} new events!")
                pending_events[user_id] = new_events
                context.user_data["pending_index"] = 0
                await show_pending_event(update, context, user_id)
                return
            else:
                await update.message.reply_text("All events already in database.")
                return

    edit_keywords = ["edit", "update", "change", "fix", "amend", "modify", "delete", "remove"]
    if any(keyword in message_text.lower() for keyword in edit_keywords):
        search_term = message_text.lower()
        for keyword in edit_keywords:
            search_term = search_term.replace(keyword, "").strip()
        if search_term and len(search_term) > 2:
            matching = search_events(search_term)
            if matching:
                events_context = "Matching events:\n" + json.dumps(matching, indent=2)
            else:
                events_context = "All events:\n" + json.dumps(get_recent_events()[:20], indent=2)

    reply, updated_history = chat_with_claude(conversations[user_id], message_text, scraped_content, events_context)
    conversations[user_id] = updated_history

    save_data = extract_command(reply, "SAVE_EVENT:")
    update_data = extract_command(reply, "UPDATE_EVENT:")
    delete_data = extract_command(reply, "DELETE_EVENT:")

    if save_data:
        display_reply = reply.split("SAVE_EVENT:")[0].strip()
        if display_reply: await update.message.reply_text(display_reply)
        location = save_data.get("address") or save_data.get("location_name", "")
        lat, lng = geocode_location(location)
        try:
            save_event(save_data, lat, lng)
            conversations[user_id] = []
            await update.message.reply_text(f"✅ '{save_data.get('title')}' added!")
        except Exception as e:
            await update.message.reply_text(f"Failed: {e}")

    elif update_data:
        display_reply = reply.split("UPDATE_EVENT:")[0].strip()
        if display_reply: await update.message.reply_text(display_reply)
        event_id = update_data.pop("id", None)
        if event_id:
            try:
                if "location_name" in update_data or "address" in update_data:
                    location = update_data.get("address") or update_data.get("location_name", "")
                    lat, lng = geocode_location(location)
                    if lat: update_data["latitude"] = lat; update_data["longitude"] = lng
                supabase.table("events").update(update_data).eq("id", event_id).execute()
                conversations[user_id] = []
                await update.message.reply_text("Event updated!")
            except Exception as e:
                await update.message.reply_text(f"Failed: {e}")

    elif delete_data:
        display_reply = reply.split("DELETE_EVENT:")[0].strip()
        if display_reply: await update.message.reply_text(display_reply)
        event_id = delete_data.get("id")
        if event_id:
            try:
                supabase.table("events").delete().eq("id", event_id).execute()
                conversations[user_id] = []
                await update.message.reply_text("Deleted!")
            except Exception as e:
                await update.message.reply_text(f"Failed: {e}")
    else:
        await update.message.reply_text(reply)

    return CHATTING

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    conversations[user_id] = []
    pending_events.pop(user_id, None)
    context.user_data.clear()
    await update.message.reply_text("Started fresh!")
    return ConversationHandler.END

def main():
    # Start scheduler in background
    start_scheduler()

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    conv_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message)],
        states={CHATTING: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message)]},
        fallbacks=[CommandHandler("cancel", cancel)]
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("list", list_events))
    app.add_handler(CommandHandler("scan", scan_command))
    app.add_handler(CommandHandler("hunt", hunt_command))
    app.add_handler(CommandHandler("verify", verify_command))
    app.add_handler(CommandHandler("setverified", setverified_command))
    app.add_handler(CommandHandler("setimage", setimage_command))
    app.add_handler(CommandHandler("addsource", addsource_command))
    app.add_handler(CommandHandler("listsources", listsources_command))
    app.add_handler(CommandHandler("removesource", removesource_command))
    app.add_handler(CommandHandler("runscrape", runscrape_command))
    app.add_handler(CommandHandler("scrapestat", scrapestat_command))
    app.add_handler(CallbackQueryHandler(handle_approval_callback))
    app.add_handler(conv_handler)

    print("VaroomBot running with auto-scraper...")
    app.run_polling()

if __name__ == "__main__":
    main()