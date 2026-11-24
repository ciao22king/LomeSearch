package org.lomesearch.android;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * Address handling for the on-device pages.
 *
 * The engine runs inside the WebView (the same bundle the web edition uses), so
 * there is no port and no server address: a bare word becomes a hash on the
 * bundled search page, anything that looks like a host is a navigation.
 */
final class Engine {
    static final String ASSET_ROOT = "file:///android_asset/web/";
    static final String HOME = ASSET_ROOT + "index.html?embed=1";

    private Engine() {}

    static String home() {
        return HOME;
    }

    /** `lome://search?q=…` opens the bundled results page. */
    static String search(String input) {
        return HOME + "#q=" + encode(input);
    }

    /** `lome://privacy` and friends map onto the pages of the web edition. */
    static String page(String route) {
        return HOME + "#lome:" + route;
    }

    static String encode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            return value == null ? "" : value;
        }
    }

    static boolean looksLikeAddress(String input) {
        String value = input.trim();
        if (value.isEmpty()) return false;
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("file://")) {
            return true;
        }
        if (value.contains(" ")) return false;
        if (lower.startsWith("localhost") || lower.matches("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/.*)?$")) {
            return true;
        }
        int slash = value.indexOf('/');
        String host = slash < 0 ? value : value.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        int dot = host.indexOf('.');
        return dot > 0 && dot < host.length() - 1 && !host.endsWith(".");
    }

    /** A bare host gets https; everything else is a query on the local index. */
    static String resolve(String input) {
        String value = input.trim();
        if (!looksLikeAddress(value)) return search(value);
        if (value.contains("://")) return value;
        return "https://" + value;
    }

    static boolean isAssetUrl(String url) {
        return url != null && url.startsWith(ASSET_ROOT);
    }

    /** The address bar shows `lome://…` for the bundled pages instead of a path. */
    static String displayUrl(String url) {
        if (url == null) return "";
        if (!isAssetUrl(url)) return url;
        String fragment = url.contains("#") ? url.substring(url.indexOf('#') + 1) : "";
        if (fragment.isEmpty()) return "lome://newtab";
        if (fragment.startsWith("q=")) return "lome://search?" + fragment;
        if (fragment.startsWith("lome:")) return "lome://" + fragment.substring("lome:".length());
        return "lome://" + fragment;
    }
}
