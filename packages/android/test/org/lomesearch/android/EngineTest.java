package org.lomesearch.android;

public class EngineTest {
    static int failures = 0;
    static void check(String label, Object actual, Object expected) {
        boolean ok = String.valueOf(actual).equals(String.valueOf(expected));
        System.out.println((ok ? "ok   " : "FAIL ") + label + " -> " + actual);
        if (!ok) { failures++; System.out.println("     expected " + expected); }
    }
    public static void main(String[] args) {
        check("address domain", Engine.looksLikeAddress("example.com"), true);
        check("address domain path", Engine.looksLikeAddress("example.com/docs"), true);
        check("address ipv4 port", Engine.looksLikeAddress("192.168.1.10:7717"), true);
        check("address localhost", Engine.looksLikeAddress("localhost:7717"), true);
        check("address scheme", Engine.looksLikeAddress("https://news.ycombinator.com"), true);
        check("query words", Engine.looksLikeAddress("how to cook pasta"), false);
        check("query with dot", Engine.looksLikeAddress("what is 3.14"), false);
        check("query single word", Engine.looksLikeAddress("privacy"), false);
        check("resolve query", Engine.resolve("privacy browser"), Engine.HOME + "#q=privacy+browser");
        check("resolve domain", Engine.resolve("example.com"), "https://example.com");
        check("resolve url", Engine.resolve("http://example.com/a"), "http://example.com/a");
        check("home", Engine.home(), "file:///android_asset/web/index.html?embed=1");
        check("search encode", Engine.search("caffè & tè"),
                "file:///android_asset/web/index.html?embed=1#q=caff%C3%A8+%26+t%C3%A8");
        check("page route", Engine.page("settings"),
                "file:///android_asset/web/index.html?embed=1#lome:settings");
        check("asset url", Engine.isAssetUrl(Engine.home()), true);
        check("asset url foreign", Engine.isAssetUrl("https://example.com"), false);
        check("display newtab", Engine.displayUrl(Engine.home()), "lome://newtab");
        check("display search", Engine.displayUrl(Engine.search("privacy")), "lome://search?q=privacy");
        check("display settings", Engine.displayUrl(Engine.page("settings")), "lome://settings");
        check("display web", Engine.displayUrl("https://example.com/a"), "https://example.com/a");
        System.out.println(failures == 0 ? "all checks passed" : failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
