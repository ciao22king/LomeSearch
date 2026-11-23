package org.lomesearch.android;

public class EngineTest {
    static int failures = 0;
    static void check(String label, Object actual, Object expected) {
        boolean ok = String.valueOf(actual).equals(String.valueOf(expected));
        System.out.println((ok ? "ok   " : "FAIL ") + label + " -> " + actual);
        if (!ok) { failures++; System.out.println("     expected " + expected); }
    }
    public static void main(String[] args) {
        String o = Engine.normalizeOrigin("http://127.0.0.1:7717");
        check("origin trailing slash", Engine.normalizeOrigin("192.168.1.10:7717/"), "http://192.168.1.10:7717");
        check("origin default", Engine.normalizeOrigin("  "), Engine.DEFAULT_ORIGIN);
        check("address domain", Engine.looksLikeAddress("example.com"), true);
        check("address domain path", Engine.looksLikeAddress("example.com/docs"), true);
        check("address ipv4 port", Engine.looksLikeAddress("192.168.1.10:7717"), true);
        check("address localhost", Engine.looksLikeAddress("localhost:7717"), true);
        check("address scheme", Engine.looksLikeAddress("https://news.ycombinator.com"), true);
        check("query words", Engine.looksLikeAddress("how to cook pasta"), false);
        check("query with dot", Engine.looksLikeAddress("what is 3.14"), false);
        check("query single word", Engine.looksLikeAddress("privacy"), false);
        check("resolve query", Engine.resolve(o, "privacy browser"), o + "/search?q=privacy+browser");
        check("resolve domain", Engine.resolve(o, "example.com"), "https://example.com");
        check("resolve url", Engine.resolve(o, "http://example.com/a"), "http://example.com/a");
        check("home", Engine.home(o), "http://127.0.0.1:7717/");
        check("search encode", Engine.search(o, "caffè & tè"), "http://127.0.0.1:7717/search?q=caff%C3%A8+%26+t%C3%A8");
        System.out.println(failures == 0 ? "all checks passed" : failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
