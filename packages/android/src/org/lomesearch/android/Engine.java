package org.lomesearch.android;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.Locale;

/** Address handling: decides between a search on the local engine and a plain navigation. */
final class Engine {
    static final String DEFAULT_ORIGIN = "http://127.0.0.1:7717";

    private Engine() {}

    static String normalizeOrigin(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return DEFAULT_ORIGIN;
        if (!value.contains("://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    static String home(String origin) {
        return origin + "/";
    }

    static String search(String origin, String query) {
        try {
            return origin + "/search?q=" + URLEncoder.encode(query, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            return origin + "/search?q=" + query;
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

    static String resolve(String origin, String input) {
        String value = input.trim();
        if (looksLikeAddress(value)) {
            return value.contains("://") ? value : "https://" + value;
        }
        return search(origin, value);
    }
}
