package io.github.flowergorge.moadoogi;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipData;
import android.text.Html;
import java.net.URI;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.util.UUID;

/** Receives text shares. Authentication and save-only UI run in the trusted browser. */
public final class MainActivity extends Activity {
    private static final String PAGE = "https://flowergorge.github.io/moadoogi/mobile.html";
    private boolean wentToBrowser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView message = new TextView(this);
        message.setText("모아두기를 여는 중…");
        message.setTextSize(18);
        message.setPadding(32, 100, 32, 32);
        setContentView(message);
        if (state != null) { finish(); return; }
        Uri destination = Uri.parse(PAGE);
        Intent incoming = getIntent();
        try {
            if (Intent.ACTION_SEND.equals(incoming.getAction()) || Intent.ACTION_PROCESS_TEXT.equals(incoming.getAction())) {
                CharSequence shared = incoming.getCharSequenceExtra(Intent.ACTION_PROCESS_TEXT.equals(incoming.getAction())
                    ? Intent.EXTRA_PROCESS_TEXT : Intent.EXTRA_TEXT);
                // Some text-sharing apps only populate ClipData. Never read content:// URIs.
                if (shared == null && incoming.getClipData() != null && incoming.getClipData().getItemCount() > 0) {
                    shared = incoming.getClipData().getItemAt(0).getText();
                }
                if (shared == null) {
                    String html = incoming.getStringExtra(Intent.EXTRA_HTML_TEXT);
                    if (html != null && html.length() <= 50000) shared = Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY);
                }
                String sourceUrl = sharedSourceUrl(incoming);
                String text = shared == null ? "" : shared.toString().trim();
                if (text.isEmpty() && !sourceUrl.isEmpty()) text = sourceUrl;
                String title = incoming.getStringExtra(Intent.EXTRA_SUBJECT);
                if (title == null) title = incoming.getStringExtra(Intent.EXTRA_TITLE);
                if (text.isEmpty() || text.length() > 12000) {
                    Toast.makeText(this, text.isEmpty() ? "공유할 링크나 텍스트가 없어요." : "공유할 텍스트가 너무 길어요.", Toast.LENGTH_LONG).show();
                    finish(); return;
                }
                JSONObject payload = new JSONObject();
                payload.put("id", UUID.randomUUID().toString());
                payload.put("text", text);
                payload.put("sourceUrl", sourceUrl);
                payload.put("title", title == null ? "" : title.substring(0, Math.min(300, title.length())));
                // Fragment data is not sent to GitHub Pages or included in Referer headers.
                destination = Uri.parse(PAGE + "?capture=1#share=" + Uri.encode(payload.toString()));
            }
            // Official Custom Tabs low-level protocol; uses the user's default browser.
            Intent tab = new Intent(Intent.ACTION_VIEW, destination);
            Bundle extras = new Bundle();
            extras.putBinder("android.support.customtabs.extra.SESSION", null);
            extras.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", Color.rgb(246, 247, 251));
            extras.putInt("androidx.browser.customtabs.extra.SHARE_STATE", 2);
            tab.putExtras(extras);
            startActivity(tab);
        } catch (ActivityNotFoundException error) {
            message.setText("Chrome 등 웹브라우저를 설치하거나 사용 설정한 뒤 다시 열어 주세요.");
        } catch (Exception error) {
            message.setText("공유 내용을 읽을 수 없어요. 원래 앱에서 다시 공유해 주세요.");
        }
    }

    // Accept only explicit web links carried with this share. A referrer identifies the
    // sending app and must never be guessed to be the page containing selected text.
    private static String sharedSourceUrl(Intent incoming) {
        String source = safeWebUrl(incoming.getDataString());
        if (!source.isEmpty()) return source;
        ClipData clip = incoming.getClipData();
        if (clip != null) for (int i = 0; i < Math.min(clip.getItemCount(), 20); i++) {
            ClipData.Item item = clip.getItemAt(i);
            source = safeWebUrl(item.getUri() == null ? null : item.getUri().toString());
            if (!source.isEmpty()) return source;
            source = safeWebUrl(item.getText() == null ? null : item.getText().toString());
            if (!source.isEmpty()) return source;
        }
        return "";
    }

    private static String safeWebUrl(String value) {
        if (value == null || value.length() > 4096) return "";
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme();
            return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && uri.getHost() != null && uri.getRawUserInfo() == null ? uri.toASCIIString() : "";
        } catch (Exception error) { return ""; }
    }

    @Override public void onStop() { super.onStop(); wentToBrowser = true; }
    @Override public void onResume() {
        super.onResume();
        // Closing the Custom Tab returns directly to the app that initiated sharing.
        if (wentToBrowser) finish();
    }
}
