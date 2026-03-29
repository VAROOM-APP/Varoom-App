import os
import json
import requests
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler
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
        return soup.get_text(separator=" ", strip=True)[:6000]
    except Exception as e:
        return f"Could not scrape: {e}"

def search_web(query):
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        results = []
        for result in soup.select(".result__body")[:5]:
            text = result.get_text(separator=" ", strip=True)
            if text:
                results.append(text[:500])
        return "\n\n".join(results) if results else "No results found"
    except Exception as e:
        return f"Search failed: {e}"

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

You can update multiple fields at once in the UPDATE_EVENT JSON.

DELETING EVENTS:
When user wants to delete, confirm first then output:
DELETE_EVENT:{"id":123}

RECURRING EVENTS:
If an event repeats (weekly, monthly etc), set is_recurring to true and recurrence to a description like "Monthly - first Sunday" or "Weekly - every Sunday".

IMPORTANT:
- You are talking to the admin, not a regular user
- Be concise and helpful
- Don't ask for information that wasn't requested
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

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return
    user_id = update.message.from_user.id
    conversations[user_id] = []
    await update.message.reply_text(
        "Hey! VaroomBot here 🚗\n\n"
        "Just talk to me naturally! For example:\n"
        "- Tell me about an event to add it\n"
        "- Paste a URL to scrape it\n"
        "- Say 'edit the Goodwood event' to edit\n"
        "- Say 'delete the test event' to delete\n\n"
        "Commands:\n"
        "/list - see recent events\n"
        "/cancel - start over"
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
            recurring = " (recurring)" if e.get("is_recurring") else ""
            msg += f"ID: {e['id']} | {e['date']} | {e['title']} | {e['event_type']}{recurring}\n"
        msg += "\nJust tell me which one to edit or delete!"
        await update.message.reply_text(msg)
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_allowed(update.message.from_user.id):
        return

    user_id = update.message.from_user.id
    message_text = update.message.text

    if user_id not in conversations:
        conversations[user_id] = []

    scraped_content = None
    events_context = None

    if message_text.startswith("http"):
        await update.message.reply_text("Fetching that page...")
        scraped_content = scrape_url(message_text)

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
                f"Done! '{save_data.get('title')}' added to Varoom!\n"
                f"Coords: {lat}, {lng}\n"
                f"It will appear on varoom.app shortly."
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
                await update.message.reply_text(f"Event updated successfully!")
            except Exception as e:
                await update.message.reply_text(f"Failed to update: {e}")
        else:
            await update.message.reply_text("Could not find event ID to update.")

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
    await update.message.reply_text("Started fresh! What would you like to do?")
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
    app.add_handler(conv_handler)

    print("VaroomBot is running...")
    app.run_polling()

if __name__ == "__main__":
    main()