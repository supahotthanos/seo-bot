-- seo-bot · drive the Mini's Safari (logged-in Google account) for a SERP capture.
-- Navigates the front Safari tab to the given URL and returns the page HTML source, which the
-- Node side parses with parseGoogleSerpHtml. No "Allow JavaScript from Apple Events" needed.
--   osascript scripts/safari-search.applescript "https://www.google.com/search?q=..."
on run argv
  set theURL to item 1 of argv
  tell application "Safari"
    if (count of documents) is 0 then make new document
    set URL of front document to theURL
  end tell
  delay 6
  tell application "Safari" to return source of front document
end run
