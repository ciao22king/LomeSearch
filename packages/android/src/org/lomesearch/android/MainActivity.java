package org.lomesearch.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * LomeSearch for Android: a WebView browser whose search pages are bundled in
 * the APK.
 *
 * The index runs inside the page (the same bundle the web edition uses), so the
 * app opens no port and needs no engine address: `lome://search`, `lome://
 * settings` and the other internal pages are assets, and the only traffic is the
 * websites the reader visits.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "lomesearch";
    private static final String KEY_COOKIES = "cookies";

    private EditText address;
    private WebView web;
    private ProgressBar progress;
    private Button back;
    private Button forward;
    private Button reload;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.main);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        address = findViewById(R.id.address);
        web = findViewById(R.id.web);
        progress = findViewById(R.id.progress);
        back = findViewById(R.id.btn_back);
        forward = findViewById(R.id.btn_forward);
        reload = findViewById(R.id.btn_reload);
        Button menu = findViewById(R.id.btn_menu);

        styleStatusBar();
        configureWebView();
        wireNavigation(menu);

        if (state != null) {
            web.restoreState(state);
        } else {
            String target = intentUrl(getIntent());
            web.loadUrl(target == null ? Engine.home() : target);
        }
    }

    private void styleStatusBar() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(0x1B, 0x4D, 0x3E));
        window.setNavigationBarColor(Color.rgb(0xFF, 0xFF, 0xFF));
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // The bundled pages are assets; the web cannot read other local files.
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LomeSearch/1.1");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptThirdPartyCookies(web, false);
        cookies.setAcceptCookie(prefs.getBoolean(KEY_COOKIES, false));

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE);
                progress.setProgress(value);
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                // Only the bundled pages may use file://; anything else is refused.
                if ("file".equals(scheme)) return !Engine.isAssetUrl(uri.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!address.hasFocus()) address.setText(Engine.displayUrl(url));
                refreshHistoryButtons();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    CharSequence description = error == null ? null : error.getDescription();
                    showOfflinePage(description == null ? "Connection failed" : description.toString());
                }
            }
        });
    }

    private void wireNavigation(Button menu) {
        back.setOnClickListener(v -> goBack());
        forward.setOnClickListener(v -> {
            if (web.canGoForward()) web.goForward();
        });
        reload.setOnClickListener(v -> web.reload());
        menu.setOnClickListener(this::showMenu);

        address.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER;
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE || enter) {
                open(address.getText().toString());
                return true;
            }
            return false;
        });
    }

    private void open(String input) {
        if (input == null || input.trim().isEmpty()) return;
        hideKeyboard();
        address.clearFocus();
        String value = input.trim();
        if (value.startsWith("lome://")) {
            openRoute(value.substring("lome://".length()));
            return;
        }
        if (Engine.looksLikeAddress(value)) {
            web.loadUrl(value.contains("://") ? value : "https://" + value);
            return;
        }
        openHash("q=" + Engine.encode(value));
    }

    /** `lome://search?q=…`, `lome://settings`, `lome://privacy`. */
    private void openRoute(String route) {
        if (route.startsWith("search")) {
            String query = "";
            int mark = route.indexOf("?q=");
            if (mark >= 0) query = route.substring(mark + 3);
            openHash("q=" + query);
            return;
        }
        String page = route.isEmpty() ? "newtab" : route.split("[?#]")[0];
        openHash("lome:" + (page.isEmpty() ? "newtab" : page));
    }

    /**
     * Fragment navigations keep the loaded page (and its index) alive, so a
     * search does not rebuild the index; a cold start loads the asset URL.
     */
    private void openHash(String hash) {
        String current = web.getUrl();
        if (Engine.isAssetUrl(current)) {
            web.evaluateJavascript("location.hash=" + JSONObject.quote(hash), null);
        } else {
            web.loadUrl(Engine.HOME + "#" + hash);
        }
    }

    private void showMenu(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor, Gravity.END);
        popup.getMenu().add(Menu.NONE, 1, 1, R.string.menu_home);
        popup.getMenu().add(Menu.NONE, 2, 2, R.string.menu_history);
        popup.getMenu().add(Menu.NONE, 3, 3, R.string.menu_settings);
        popup.getMenu().add(Menu.NONE, 4, 4, R.string.menu_privacy);
        popup.getMenu().add(Menu.NONE, 5, 5, R.string.menu_clear);
        popup.getMenu().add(Menu.NONE, 6, 6, R.string.menu_about);
        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    web.loadUrl(Engine.home());
                    return true;
                case 2:
                    openHash("lome:history");
                    return true;
                case 3:
                    openHash("lome:settings");
                    return true;
                case 4:
                    openHash("lome:privacy");
                    return true;
                case 5:
                    clearData();
                    return true;
                case 6:
                    showAbout();
                    return true;
                default:
                    return false;
            }
        });
        popup.show();
    }

    private void clearData() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.menu_clear)
                .setMessage("Clears cookies, cache, the page history and what the internal pages stored "
                        + "(theme, query history, settings). The index is rebuilt from the bundled corpus.")
                .setPositiveButton("Clear", (dialog, which) -> {
                    CookieManager.getInstance().removeAllCookies(null);
                    CookieManager.getInstance().flush();
                    web.clearCache(true);
                    web.clearHistory();
                    web.evaluateJavascript("try{localStorage.clear()}catch(e){}", null);
                    web.loadUrl(Engine.home());
                    Toast.makeText(this, "Data cleared", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showAbout() {
        new AlertDialog.Builder(this)
                .setTitle("LomeSearch 1.1.0")
                .setMessage("Privacy-first browser with its own search engine.\n\n"
                        + "The index and the pages ship inside the app: searches run on this device, "
                        + "no server and no port. Cookies are off by default, third-party cookies are "
                        + "always blocked and mixed content never loads.\n\n"
                        + "Apache-2.0 licensed.")
                .setPositiveButton("Close", null)
                .show();
    }

    private void showOfflinePage(String reason) {
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px;color:#16211C;background:#F6F7F5}"
                + "h1{font-size:22px;color:#1B4D3E}p{line-height:1.5;color:#4A5A52}</style></head><body>"
                + "<h1>Site not reachable</h1>"
                + "<p>" + escape(reason) + "</p>"
                + "<p>Check the connection, or search the local index instead: the pages you need "
                + "may already be in it.</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        address.setText(Engine.displayUrl(web.getUrl()));
    }

    private void refreshHistoryButtons() {
        back.setEnabled(web.canGoBack());
        forward.setEnabled(web.canGoForward());
        back.setAlpha(web.canGoBack() ? 1f : 0.35f);
        forward.setAlpha(web.canGoForward() ? 1f : 0.35f);
    }

    private String intentUrl(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri data = intent.getData();
        String scheme = data.getScheme();
        return "http".equals(scheme) || "https".equals(scheme) ? data.toString() : null;
    }

    private void hideKeyboard() {
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(address.getWindowToken(), 0);
    }

    private static String escape(String value) {
        String text = value == null ? "" : value;
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private void goBack() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        if (!Engine.HOME.equals(web.getUrl())) {
            web.loadUrl(Engine.home());
            return;
        }
        finish();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intentUrl(intent);
        if (url != null) web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
        }
        super.onDestroy();
    }
}
