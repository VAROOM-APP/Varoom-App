import os
import json
import requests
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler, CallbackQueryHandler
import anthropic
from supabase import create_client

load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

ALLOWED_USERS = [8550157460, 8775030085]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

conversations = {}
pending_events = {}  # stores events awaiting approval per user

CHATTING = 1

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

def search_web(query):
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        results = []
        for result in soup.select(".result__body")[:8]:
            link = result.select_one(".result__url")
            text = result.get_text(separator=" ", strip=True)
            if text:
                url_text = link.get_text(strip=True) if link else ""
                results.append({"text": text[:300], "url": url_text})
        return results
    except Exception as e:
        return []

def find_urls_from_search(query):
    """Search DuckDuckGo and extract actual URLs from results"""
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        urls = []
        for result in soup.select(".result__a")[:8]:
            href = result.get("href", "")
            if href.startswith("http") and not any(skip in href for skip in ["duckduckgo", "google", "bing", "facebook", "twitter", "youtube"]):
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

def get_recent_events():
    result = supabase.table("events").select("id, title, date, event_type, location_name, start_time, vehicle_type, marque, is_recurring, recurrence, description, external_link, latitude, longitude, address").order("created_at", desc=True).limit(50).execute()
    return result.data or []

def search_events(query):
    result = supabase.table("events").select("id, title, date, event_type, location_name, start_time, vehicle_type, marque, is_recurring, recurrence, description, external_link, latitude, longitude, address").ilike("title", f"%{query}%").execute()
    return result.data or []

def get_existing_titles():
    """Get all existing event titles to avoid duplicates"""
    result = supabase.table("events").select("title, date").execute()
    return [(e["title"].lower(), e.get("date", "")) for e in (result.data or [])]

def extract_multiple_events(page_content, source_url):
    """Use Claude to extract ALL events from a page"""
    prompt = f"""You are extracting car and motorbike events from a UK website for the Varoom events app.

Source URL: {source_url}

Page content:
{page_content}

Extract ALL car/motorbike events you can find. For each event return a JSON object.
Return a JSON array of events. If no events found, return [].

Each event must have:
- title: string
- date: YYYY-MM-DD format (skip if no date found)
- start_time: HH:MM:SS or null
- location_name: venue/place name
- address: full address if available
- description: max 200 chars summary
- event_type: one of meets/auctions/races/autojumbles
- vehicle_type: one of car/motorbike/both
- external_link: source URL or specific event URL
- marque: specific car brand if event is brand-specific, else null
- is_recurring: true/false
- recurrence: description if recurring else null

Only include events with at least a title and some location info.
Only include UK events.
Return ONLY the JSON array, no other text."""

    try:
        response = claude.messages.create(
            model="claude-opus-4-5",
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        # Clean up response
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        if text.endswith("```"):
            text = text[:-3]
        events = json.loads(text.strip())
        return events if isinstance(events, list) else []
    except Exception as e:
        return []

def save_event(event_data, lat, lng):
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
        "is_approved": True
    }
    supabase.table("events").insert(insert_data).execute()

def chat_with_claude(conversation_history, user_message, scraped_content=None, events_context=None):
    system_prompt = """You are VaroomBot, a friendly admin assistant for the Varoom app (varoom.app) - a UK car and motorbike events discovery app.

You help the admin (Rowan or his dad) add, edit and manage car events.

ADDING EVENTS:
When adding a new event, gather these details naturally in conversation:
- title, date (YYYY-MM-DD), start_time (HH:MM:SS), location_name, address
- description (max 200 chars), event_type (meets/auctions/races/autojumbles)
- vehicle_type (car/motorbike/both), external_link (optional), marque (optional)
- is_recurring (true/false), recurrence (e.g. "Monthly - first Sunday" if recurring)

When ready to save a new event, output on its own line:
SAVE_EVENT:{"title":"...","date":"...","start_time":"...","location_name":"...","address":"...","description":"...","event_type":"...","vehicle_type":"...","external_link":null,"marque":null,"is_recurring":false,"recurrence":null}

EDITING EVENTS:
When the user wants to edit an event, search for it and show the current details.
Then make changes as requested conversationally.
When ready to save edits, output on its own line:
UPDATE_EVENT:{"id":123,"field":"value","field2":"value2"}

DELETING EVENTS:
When user wants to delete, confirm first then output:
DELETE_EVENT:{"id":123}

RECURRING EVENTS:
If an event repeats (weekly, monthly etc), set is_recurring to true and recurrence to a description like "Monthly - first Sunday" or "Weekly - every Sunday".

IMPORTANT:
- You are talking to the admin, not a regular user
- Be concise and helpful
- If the user says "save it", "add it", "yes that's right" - save the event
- Never mention "contact the Varoom team" - you ARE the Varoom team assistant"""

    messages = conversation_history.copy()
    content = user_message
    if scraped_content:
        content = f"Scraped content:\n{scraped_content}\n\nUser said: {user_message}"
    if events_context:
        content = f"Current events in database:\n{events_context}\n\nUser said: {user_message}"

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

def format_event_preview(event, index, total):
    """Format a single event for Telegram preview"""
    lines = [
        f"Event {index}/{total}",
        f"📌 {event.get('title', 'No title')}",
        f"📅 {event.get('date', 'No date')}",
        f"📍 {event.get('location_name', 'No location')}",
        f"🏷 {event.get('event_type', '?')} | {event.get('vehicle_type', '?')}",
    ]
    if event.get("marque"):
        lines.append(f"🚗 {event['marque']}")
    if event.get("description"):
        lines.append(f"📝 {event['description'][:100]}")
    if event.get("is_recurring"):
        lines.append(f"🔄 {event.get('recurrence', 'Recurring')}")
    return "\n".join(lines)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    user_id = update.message.from_user.id
    conversations[user_id] = []
    await update.message.reply_text(
        "Hey! VaroomBot here 🚗\n\n"
        "Commands:\n"
        "/list — see recent events\n"
        "/scan — scrape a list of URLs for events\n"
        "/hunt <search term> — search web and auto-scrape results\n"
        "/cancel — start over\n\n"
        "Or just talk to me to add/edit events manually!"
    )

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
            recurring = " 🔄" if e.get("is_recurring") else ""
            msg += f"ID:{e['id']} | {e['date']} | {e['title']} | {e['event_type']}{recurring}\n"
        msg += "\nTell me which one to edit or delete!"
        await update.message.reply_text(msg)
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def scan_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /scan — user sends URLs one per line"""
    if not is_allowed(update.message.from_user.id):
        return
    await update.message.reply_text(
        "Send me the URLs to scan, one per line.\n"
        "I'll scrape each one and extract all events I can find.\n\n"
        "Example:\nhttps://www.goodwood.com/events\nhttps://www.pistonheads.com/events"
    )
    user_id = update.message.from_user.id
    conversations[user_id] = [{"role": "system_scan": True}] if False else []
    context.user_data["awaiting_scan_urls"] = True

async def hunt_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /hunt <search term> — auto-search and scrape"""
    if not is_allowed(update.message.from_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text(
            "Give me a search term!\n"
            "Example: /hunt classic car shows UK 2026"
        )
        return

    query = " ".join(args)
    await update.message.reply_text(f"🔍 Hunting for: {query}\nSearching the web...")

    urls = find_urls_from_search(query + " UK events 2026")
    if not urls:
        await update.message.reply_text("Couldn't find any relevant URLs. Try a different search term.")
        return

    await update.message.reply_text(f"Found {len(urls)} sites to check:\n" + "\n".join(urls) + "\n\nScraping now...")

    user_id = update.message.from_user.id
    await process_urls(update, context, urls, user_id)

async def process_urls(update, context, urls, user_id):
    """Scrape a list of URLs and extract events, then start approval flow"""
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
        # Filter out duplicates
        new_events = [e for e in events if e.get("title", "").lower() not in existing_titles]
        dupes = len(events) - len(new_events)
        msg = f"✅ {url[:50]}...\nFound {len(events)} events"
        if dupes:
            msg += f" ({dupes} already in database, skipped)"
        await update.message.reply_text(msg)
        all_found.extend(new_events)

    if not all_found:
        await update.message.reply_text("No new events found across all URLs.")
        return

    await update.message.reply_text(
        f"Found {len(all_found)} new events total!\n\n"
        f"I'll show them one by one for approval.\n"
        f"Use the buttons to Save ✅, Skip ⏭, or Save All 💾"
    )

    pending_events[user_id] = all_found
    context.user_data["pending_index"] = 0
    await show_pending_event(update, context, user_id)

async def show_pending_event(update, context, user_id):
    """Show the next pending event for approval"""
    events = pending_events.get(user_id, [])
    index = context.user_data.get("pending_index", 0)

    if index >= len(events):
        await update.message.reply_text(
            "All done! No more events to review.\n"
            "Use /list to see what's in the database."
        )
        pending_events.pop(user_id, None)
        return

    event = events[index]
    preview = format_event_preview(event, index + 1, len(events))

    keyboard = [
        [
            InlineKeyboardButton("✅ Save", callback_data=f"save_{index}"),
            InlineKeyboardButton("⏭ Skip", callback_data=f"skip_{index}"),
        ],
        [
            InlineKeyboardButton("💾 Save All Remaining", callback_data="save_all"),
            InlineKeyboardButton("❌ Stop", callback_data="stop_review"),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(preview, reply_markup=reply_markup)

async def handle_approval_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline button presses for event approval"""
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
            await query.edit_message_text(f"❌ Failed to save: {e}")
        context.user_data["pending_index"] = index + 1
        await show_pending_event(update.callback_query, context, user_id)

    elif data.startswith("skip_"):
        await query.edit_message_text(f"⏭ Skipped: {events[index].get('title')}")
        context.user_data["pending_index"] = index + 1
        await show_pending_event(update.callback_query, context, user_id)

    elif data == "save_all":
        remaining = events[index:]
        saved = 0
        failed = 0
        for event in remaining:
            location = event.get("address") or event.get("location_name", "")
            lat, lng = geocode_location(location)
            try:
                save_event(event, lat, lng)
                saved += 1
            except:
                failed += 1
        await query.edit_message_text(
            f"💾 Saved {saved} events!\n"
            f"{'⚠️ ' + str(failed) + ' failed' if failed else ''}"
        )
        pending_events.pop(user_id, None)

    elif data == "stop_review":
        remaining = len(events) - index
        await query.edit_message_text(f"❌ Stopped. {remaining} events not reviewed.")
        pending_events.pop(user_id, None)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return

    user_id = update.message.from_user.id
    message_text = update.message.text

    if user_id not in conversations:
        conversations[user_id] = []

    # Check if user is sending URLs for /scan
    if context.user_data.get("awaiting_scan_urls"):
        context.user_data["awaiting_scan_urls"] = False
        lines = message_text.strip().split("\n")
        urls = [l.strip() for l in lines if l.strip().startswith("http")]
        if not urls:
            await update.message.reply_text("No valid URLs found. Make sure each URL starts with http.")
            return
        await update.message.reply_text(f"Got {len(urls)} URLs. Starting scrape...")
        await process_urls(update, context, urls, user_id)
        return

    scraped_content = None
    events_context = None

    if message_text.startswith("http"):
        await update.message.reply_text("Fetching that page...")
        scraped_content = scrape_url(message_text)
        # If it's just a URL with no other text, auto-extract events
        if message_text.strip() == message_text:
            events = extract_multiple_events(scraped_content, message_text)
            if events:
                existing = get_existing_titles()
                existing_titles = [t[0] for t in existing]
                new_events = [e for e in events if e.get("title", "").lower() not in existing_titles]
                if new_events:
                    await update.message.reply_text(f"Found {len(new_events)} new events on that page!")
                    pending_events[user_id] = new_events
                    context.user_data["pending_index"] = 0
                    await show_pending_event(update, context, user_id)
                    return
                else:
                    await update.message.reply_text("Found events but they're all already in the database.")
                    return

    edit_keywords = ["edit", "update", "change", "fix", "amend", "modify", "delete", "remove"]
    if any(keyword in message_text.lower() for keyword in edit_keywords):
        search_term = message_text.lower()
        for keyword in edit_keywords:
            search_term = search_term.replace(keyword, "").strip()
        if search_term and len(search_term) > 2:
            matching_events = search_events(search_term)
            if matching_events:
                events_context = "Matching events found:\n" + json.dumps(matching_events, indent=2)
            else:
                all_events = get_recent_events()
                events_context = "All events:\n" + json.dumps(all_events[:20], indent=2)

    reply, updated_history = chat_with_claude(
        conversations[user_id],
        message_text,
        scraped_content,
        events_context
    )

    conversations[user_id] = updated_history

    save_data = extract_command(reply, "SAVE_EVENT:")
    update_data = extract_command(reply, "UPDATE_EVENT:")
    delete_data = extract_command(reply, "DELETE_EVENT:")

    if save_data:
        display_reply = reply.split("SAVE_EVENT:")[0].strip()
        if display_reply:
            await update.message.reply_text(display_reply)
        location = save_data.get("address") or save_data.get("location_name", "")
        lat, lng = geocode_location(location)
        try:
            save_event(save_data, lat, lng)
            conversations[user_id] = []
            await update.message.reply_text(
                f"Done! '{save_data.get('title')}' added!\n"
                f"Coords: {lat}, {lng}"
            )
        except Exception as e:
            await update.message.reply_text(f"Failed to save: {e}")

    elif update_data:
        display_reply = reply.split("UPDATE_EVENT:")[0].strip()
        if display_reply:
            await update.message.reply_text(display_reply)
        event_id = update_data.pop("id", None)
        if event_id:
            try:
                if "location_name" in update_data or "address" in update_data:
                    location = update_data.get("address") or update_data.get("location_name", "")
                    lat, lng = geocode_location(location)
                    if lat:
                        update_data["latitude"] = lat
                        update_data["longitude"] = lng
                supabase.table("events").update(update_data).eq("id", event_id).execute()
                conversations[user_id] = []
                await update.message.reply_text("Event updated!")
            except Exception as e:
                await update.message.reply_text(f"Failed to update: {e}")
        else:
            await update.message.reply_text("Could not find event ID.")

    elif delete_data:
        display_reply = reply.split("DELETE_EVENT:")[0].strip()
        if display_reply:
            await update.message.reply_text(display_reply)
        event_id = delete_data.get("id")
        if event_id:
            try:
                supabase.table("events").delete().eq("id", event_id).execute()
                conversations[user_id] = []
                await update.message.reply_text("Event deleted!")
            except Exception as e:
                await update.message.reply_text(f"Failed to delete: {e}")

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
    app.add_handler(CallbackQueryHandler(handle_approval_callback))
    app.add_handler(conv_handler)

    print("VaroomBot running...")
    app.run_polling()

if __name__ == "__main__":
    main()