package org.lomesearch.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
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
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * LomeSearch for Android: a WebView shell for a LomeSearch engine instance.
 *
 * The engine itself is Node, so it cannot run inside an APK. This client talks to
 * an engine started on the same device through Termux or on another machine of the
 * local network, which keeps the index and the query log off third-party servers.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "lomesearch";
    private static final String KEY_ORIGIN = "origin";
    private static final String KEY_COOKIES = "cookies";
    private static final String KEY_SETUP_DONE = "setup_done";

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
            web.loadUrl(target == null ? Engine.home(origin()) : target);
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
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LomeSearch/1.0");

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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!address.hasFocus()) address.setText(displayUrl(url));
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
        back.setOnClickListener(v -> {
            if (web.canGoBack()) web.goBack();
        });
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
        web.loadUrl(Engine.resolve(origin(), input));
    }

    private void showMenu(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor, Gravity.END);
        popup.getMenu().add(Menu.NONE, 1, 1, R.string.menu_engine);
        popup.getMenu().add(Menu.NONE, 2, 2, R.string.menu_privacy);
        popup.getMenu().add(Menu.NONE, 3, 3, R.string.menu_about);
        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    askOrigin();
                    return true;
                case 2:
                    showPrivacy();
                    return true;
                case 3:
                    showAbout();
                    return true;
                default:
                    return false;
            }
        });
        popup.show();
    }

    private void askOrigin() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(origin());
        input.setSelectAllOnFocus(true);
        LinearLayout wrap = new LinearLayout(this);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        wrap.setPadding(pad, pad / 2, pad, 0);
        wrap.addView(input, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        new AlertDialog.Builder(this)
                .setTitle(R.string.menu_engine)
                .setMessage("Address of the machine running the LomeSearch engine, for example http://192.168.1.10:7717")
                .setView(wrap)
                .setPositiveButton("Save", (dialog, which) -> {
                    String value = Engine.normalizeOrigin(input.getText().toString());
                    prefs.edit().putString(KEY_ORIGIN, value).putBoolean(KEY_SETUP_DONE, true).apply();
                    web.loadUrl(Engine.home(value));
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showPrivacy() {
        boolean cookies = prefs.getBoolean(KEY_COOKIES, false);
        String[] options = {
                (cookies ? "✓ " : "   ") + "Allow cookies",
                "Clear cookies and site data",
        };
        new AlertDialog.Builder(this)
                .setTitle(R.string.menu_privacy)
                .setItems(options, (dialog, which) -> {
                    if (which == 0) {
                        boolean next = !prefs.getBoolean(KEY_COOKIES, false);
                        prefs.edit().putBoolean(KEY_COOKIES, next).apply();
                        CookieManager.getInstance().setAcceptCookie(next);
                        Toast.makeText(this, next ? "Cookies allowed" : "Cookies blocked", Toast.LENGTH_SHORT).show();
                    } else {
                        CookieManager.getInstance().removeAllCookies(null);
                        CookieManager.getInstance().flush();
                        web.clearCache(true);
                        web.clearHistory();
                        Toast.makeText(this, "Cookies and cache cleared", Toast.LENGTH_SHORT).show();
                    }
                })
                .setMessage("Cookies are off by default, third-party cookies are always blocked, "
                        + "and mixed content never loads. Nothing is sent to LomeSearch servers: "
                        + "queries go to your own engine.")
                .setPositiveButton("Close", null)
                .show();
    }

    private void showAbout() {
        new AlertDialog.Builder(this)
                .setTitle("LomeSearch 1.0.0")
                .setMessage("Privacy-first search client. Queries stay on the engine you point it at. "
                        + "Engine: " + origin() + "\n\n"
                        + "The Android build is a client: the index runs on a desktop or under Termux. "
                        + "Apache-2.0 licensed.")
                .setPositiveButton("Close", null)
                .show();
    }

    private void showOfflinePage(String reason) {
        String originText = origin();
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px;color:#16211C;background:#F6F7F5}"
                + "h1{font-size:22px;color:#1B4D3E}code{background:#E2ECE7;padding:2px 6px;border-radius:4px}"
                + "p{line-height:1.5;color:#4A5A52}</style></head><body>"
                + "<h1>Engine not reachable</h1>"
                + "<p>The app could not reach <code>" + escape(originText) + "</code>.</p>"
                + "<p>" + escape(reason == null ? "Connection failed" : reason) + "</p>"
                + "<p>Start the engine with <code>lomesearch serve --bind 0.0.0.0</code> on the machine that "
                + "holds the index, then set its address from the menu.</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        address.setText(originText);
        if (!prefs.getBoolean(KEY_SETUP_DONE, false)) {
            askOrigin();
        }
    }

    private void refreshHistoryButtons() {
        back.setEnabled(web.canGoBack());
        forward.setEnabled(web.canGoForward());
        back.setAlpha(web.canGoBack() ? 1f : 0.35f);
        forward.setAlpha(web.canGoForward() ? 1f : 0.35f);
    }

    private String displayUrl(String url) {
        if (url == null) return "";
        String origin = origin();
        if (url.startsWith(origin)) {
            String rest = url.substring(origin.length());
            return rest.isEmpty() ? origin : rest;
        }
        return url;
    }

    private String intentUrl(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri data = intent.getData();
        String scheme = data.getScheme();
        return "http".equals(scheme) || "https".equals(scheme) ? data.toString() : null;
    }

    private String origin() {
        return Engine.normalizeOrigin(prefs.getString(KEY_ORIGIN, Engine.DEFAULT_ORIGIN));
    }

    private void hideKeyboard() {
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(address.getWindowToken(), 0);
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intentUrl(intent);
        if (url != null) web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
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
