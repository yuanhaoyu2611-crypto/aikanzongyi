package com.aikanzongyi.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new SearchBridge(), "AndroidSearch");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    public class SearchBridge {
        @JavascriptInterface
        public void search(String query, String callbackName) {
            executor.execute(() -> {
                String payload;
                try {
                    List<Result> xhsResults = searchBing(
                            "site:xiaohongshu.com \"" + query + "\" 更新计划 播出时间 第几期 综艺",
                            "小红书",
                            "xiaohongshu.com"
                    );
                    if (xhsResults.isEmpty()) {
                        xhsResults.add(xiaohongshuShortcut(query));
                    }

                    List<Result> generalResults = new ArrayList<>();
                    generalResults.addAll(searchBaidu("\"" + query + "\" 更新时间 播出时间 第几期", "百度"));
                    generalResults.addAll(searchBing("\"" + query + "\" 更新计划 播出时间 第几期 综艺", "网页", ""));
                    generalResults.addAll(searchBing("\"" + query + "\" 更新时间 每周几 共多少期", "网页", ""));
                    generalResults = prioritize(query, dedupe(generalResults));

                    List<Result> merged = new ArrayList<>();
                    merged.addAll(xhsResults);
                    merged.addAll(generalResults);
                    payload = "{\"results\":" + toJson(dedupe(merged), 10) + "}";
                } catch (Exception error) {
                    payload = "{\"results\":[],\"error\":\"" + json(error.getMessage()) + "\"}";
                }

                String script = "window." + callbackName + "(" + quote(payload) + ")";
                runOnUiThread(() -> webView.evaluateJavascript(script, null));
            });
        }
    }

    private List<Result> searchBing(String query, String source, String hostFilter) throws Exception {
        String url = "https://www.bing.com/search?q=" + URLEncoder.encode(query, "UTF-8");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(9000);
        connection.setReadTimeout(9000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36");
        connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6");

        StringBuilder html = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                html.append(line).append('\n');
            }
        }

        List<Result> results = parseBingResults(html.toString(), source);
        if (hostFilter.isEmpty()) {
            return results;
        }

        List<Result> filtered = new ArrayList<>();
        for (Result result : results) {
            if (result.url.contains(hostFilter)) {
                filtered.add(result);
            }
        }
        return filtered;
    }

    private List<Result> parseBingResults(String html, String source) {
        List<Result> results = new ArrayList<>();
        Matcher blockMatcher = Pattern.compile("<li class=\"b_algo\"[\\s\\S]*?</li>").matcher(html);
        while (blockMatcher.find()) {
            String block = blockMatcher.group();
            Matcher linkMatcher = Pattern.compile("<h2[^>]*>\\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>").matcher(block);
            if (!linkMatcher.find()) {
                continue;
            }
            Matcher snippetMatcher = Pattern.compile("<p[^>]*>([\\s\\S]*?)</p>").matcher(block);
            String url = decodeHtml(linkMatcher.group(1));
            String title = cleanHtml(linkMatcher.group(2));
            String snippet = snippetMatcher.find() ? cleanHtml(snippetMatcher.group(1)) : "";
            results.add(new Result(title, url, snippet, url.contains("xiaohongshu.com") ? "小红书" : source));
        }
        return results;
    }

    private List<Result> searchBaidu(String query, String source) throws Exception {
        String url = "https://www.baidu.com/s?wd=" + URLEncoder.encode(query, "UTF-8");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(9000);
        connection.setReadTimeout(9000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36");
        connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6");

        StringBuilder html = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                html.append(line).append('\n');
            }
        }
        return parseBaiduResults(html.toString(), source);
    }

    private List<Result> parseBaiduResults(String html, String source) {
        List<Result> results = new ArrayList<>();
        Matcher blockMatcher = Pattern.compile("<div[^>]+(?:class|tpl)=\"[^\"]*(?:result|c-container)[^\"]*\"[\\s\\S]*?(?=<div[^>]+(?:class|tpl)=\"[^\"]*(?:result|c-container)|</body>)").matcher(html);
        while (blockMatcher.find()) {
            String block = blockMatcher.group();
            Matcher linkMatcher = Pattern.compile("<h3[\\s\\S]*?<a[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>[\\s\\S]*?</h3>").matcher(block);
            if (!linkMatcher.find()) {
                continue;
            }
            String snippet = cleanHtml(block);
            if (snippet.length() > 260) {
                snippet = snippet.substring(0, 260);
            }
            results.add(new Result(cleanHtml(linkMatcher.group(2)), decodeHtml(linkMatcher.group(1)), snippet, source));
        }
        return results;
    }

    private List<Result> prioritize(String query, List<Result> results) {
        String normalizedQuery = normalize(query);
        List<Result> relevant = new ArrayList<>();
        for (Result result : results) {
            String text = normalize(result.title + " " + result.snippet);
            if (text.contains(normalizedQuery)) {
                relevant.add(result);
            }
        }
        return relevant;
    }

    private List<Result> dedupe(List<Result> results) {
        List<Result> filtered = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Result result : results) {
            String key = result.url.replaceAll("[?#].*$", "");
            if (seen.add(key)) {
                filtered.add(result);
            }
        }
        return filtered;
    }

    private Result xiaohongshuShortcut(String query) throws Exception {
        String keyword = query + " 更新计划 播出时间 第几期 综艺";
        return new Result(
                "在小红书搜索「" + query + "」",
                "https://www.xiaohongshu.com/search_result?keyword=" + URLEncoder.encode(keyword, "UTF-8"),
                "打开小红书查看用户笔记和节目讨论，核对后可粘贴内容识别更新计划。",
                "小红书"
        );
    }

    private String toJson(List<Result> results, int limit) {
        StringBuilder builder = new StringBuilder("[");
        int count = Math.min(results.size(), limit);
        for (int i = 0; i < count; i++) {
            Result result = results.get(i);
            if (i > 0) builder.append(',');
            builder
                    .append('{')
                    .append("\"title\":\"").append(json(result.title)).append("\",")
                    .append("\"url\":\"").append(json(result.url)).append("\",")
                    .append("\"snippet\":\"").append(json(result.snippet)).append("\",")
                    .append("\"source\":\"").append(json(result.source)).append("\"")
                    .append('}');
        }
        return builder.append(']').toString();
    }

    private String normalize(String value) {
        return value == null ? "" : value.toLowerCase().replaceAll("\\s+", "");
    }

    private String cleanHtml(String value) {
        return decodeHtml(value.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim());
    }

    private String decodeHtml(String value) {
        return value
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
    }

    private String quote(String value) {
        return "\"" + json(value) + "\"";
    }

    private String json(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static class Result {
        final String title;
        final String url;
        final String snippet;
        final String source;

        Result(String title, String url, String snippet, String source) {
            this.title = title;
            this.url = url;
            this.snippet = snippet;
            this.source = source;
        }
    }
}
