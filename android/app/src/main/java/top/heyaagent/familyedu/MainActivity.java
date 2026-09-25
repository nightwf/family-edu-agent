package top.heyaagent.familyedu;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * 禾芽家庭私教（安卓平板 / 手机客户端）。
 *
 * 客户端只负责承载线上站点：页面、登录、数据都在 https://heyaagent.top 上，
 * 所以服务端更新后 App 无需重新发版。这里额外处理的是原生体验：
 * 系统栏适配、返回键、禁用误触下拉刷新、断网重试，以及把登录二维码长按保存到相册，
 * 方便只有一台设备时用微信「扫一扫 - 相册」完成扫码登录。
 */
public class MainActivity extends Activity {

    private static final String TAG = "HeYaApp";
    private static final String HOME_URL = "https://heyaagent.top/";
    private static final String ALLOWED_HOST_SUFFIX = "heyaagent.top";
    private static final int REQUEST_WRITE_STORAGE = 1001;
    private static final int REQUEST_WEB_MEDIA = 1002;
    private static final int REQUEST_FILE_CHOOSER = 1003;
    private static final long BACK_PRESS_INTERVAL_MS = 2000L;

    private WebView webView;
    private ProgressBar progressBar;
    private View loadingOverlay;
    private View errorView;
    private TextView errorDetail;

    private boolean firstPageFinished = false;
    private boolean qrHintShown = false;
    private boolean qrHintWatching = false;
    private int qrHintChecks = 0;
    private long lastBackPressedAt = 0L;
    private String pendingQrImageUrl = null;
    /** WebView 请求的媒体权限（私教「按住说话」要麦克风）。 */
    private PermissionRequest pendingMediaPermission = null;
    /** 网页里 `<input type="file">` 的回调（私教「插一张照片」用）。 */
    private ValueCallback<Uri[]> filePathCallback = null;
    /** 拍照时预先分配好的输出地址，相机把照片写进这里。 */
    private Uri pendingCameraUri = null;
    /** 顶部下拉只消费越界手势，不让 WebView/系统把它解释成整页刷新。 */
    private float pullStartY = 0f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        progressBar = findViewById(R.id.progress_bar);
        loadingOverlay = findViewById(R.id.loading_overlay);
        errorView = findViewById(R.id.error_view);
        errorDetail = findViewById(R.id.error_detail);

        styleSystemBars();
        applyWindowInsets(findViewById(R.id.root));

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        configureWebView();

        Button retry = findViewById(R.id.retry_button);
        retry.setOnClickListener(view -> reload());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    /** 状态栏、导航栏使用品牌米色配深色图标，避免浏览器默认黑边。 */
    private void styleSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(getColor(R.color.heya_cream));
        window.setNavigationBarColor(getColor(R.color.heya_cream));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** 刘海屏 / 手势条：给内容留出安全区域，页面不会被系统栏遮挡。 */
    private void applyWindowInsets(final View root) {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = 0;
            int bottom = 0;
            int left = 0;
            int right = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top;
                bottom = bars.bottom;
                left = bars.left;
                right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            if (view.getPaddingTop() != top || view.getPaddingBottom() != bottom
                    || view.getPaddingLeft() != left || view.getPaddingRight() != right) {
                view.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        root.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        String ua = settings.getUserAgentString();
        if (ua != null && !ua.contains("HeYaAndroid")) {
            settings.setUserAgentString(ua + " HeYaAndroid/1.0");
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(getColor(R.color.heya_cream));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    pullStartY = event.getY();
                    break;
                case MotionEvent.ACTION_MOVE:
                    if (webView.getScrollY() <= 0 && event.getY() > pullStartY) {
                        // 到顶后继续往下拉时只吃掉越界移动，点击、上滑和页内滚动不受影响。
                        return true;
                    }
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    pullStartY = 0f;
                    break;
                default:
                    break;
            }
            return false;
        });
        webView.setWebViewClient(new HeYaWebViewClient());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                }
            }

            /**
             * 网页里要用麦克风（私教「按住说话」）时，WebView 会先问这里。
             * 不实现这个方法，页面上能用的功能在 App 里会静默失败。
             */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    request.grant(request.getResources());
                    return;
                }
                boolean wantsAudio = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
                }
                if (!wantsAudio) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    return;
                }
                // 先挂起授权结果，拿到系统回调后再回应网页
                pendingMediaPermission = request;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_WEB_MEDIA);
            }

            /**
             * 网页里的 `<input type="file">`（私教「插一张照片」、题库附件）会走到这里。
             * 不实现这个方法，页面上那个按钮在 App 里就是**点了没反应**——不报错，
             * 也不弹任何东西，最难排查的那种坏法。
             */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return openFileChooser(callback, params);
            }
        });

        webView.setOnLongClickListener(view -> handleLongPress());
    }

    private void reload() {
        errorView.setVisibility(View.GONE);
        if (webView.getUrl() == null) {
            webView.loadUrl(HOME_URL);
        } else {
            webView.reload();
        }
    }

    /**
     * 打开系统文件选择器：相册文件 + 直接拍照。
     *
     * 网页给的 accept 决定能选什么（私教只要 image/*，题库还包含 pdf/doc）。
     * 只要用户可能要图片，就在选择器里额外挂一个「拍照」入口，照片写到
     * 我们自己的 Provider 里再交回网页，不落用户相册。
     */
    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        // 上一次的回调必须收尾，否则 WebView 会一直认为选择器还开着
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        filePathCallback = callback;
        pendingCameraUri = null;

        List<String> mimeTypes = new ArrayList<>();
        boolean wantsImage = false;
        String[] accepted = params == null ? null : params.getAcceptTypes();
        if (accepted != null) {
            for (String raw : accepted) {
                if (raw == null) continue;
                // accept 可能是逗号分隔的一串，也可能是 .pdf 这种后缀
                for (String part : Arrays.asList(raw.split(","))) {
                    String type = part.trim();
                    if (type.isEmpty() || type.startsWith(".")) continue;
                    if (!mimeTypes.contains(type)) mimeTypes.add(type);
                    if (type.startsWith("image/")) wantsImage = true;
                }
            }
        }
        boolean multiple = params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;

        Intent content = new Intent(Intent.ACTION_GET_CONTENT);
        content.addCategory(Intent.CATEGORY_OPENABLE);
        if (mimeTypes.isEmpty()) {
            content.setType("*/*");
        } else if (mimeTypes.size() == 1) {
            content.setType(mimeTypes.get(0));
        } else {
            content.setType("*/*");
            content.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
        }
        if (multiple) content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        Intent chooser = Intent.createChooser(content, getString(R.string.pick_file_title));
        Intent capture = wantsImage ? buildCaptureIntent() : null;
        if (capture != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{capture});
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        }

        try {
            startActivityForResult(chooser, REQUEST_FILE_CHOOSER);
        } catch (Exception error) {
            Log.w(TAG, "打不开文件选择器", error);
            releaseFileChooser();
            toast(getString(R.string.pick_file_failed));
            return false;
        }
        return true;
    }

    /**
     * 构造「拍照」意图。照片输出必须走 content:// 地址（Android 7 起用 file:// 会崩），
     * 并且要显式把写入权限授予相机应用——经过 createChooser 之后 flags 不一定带得过去。
     */
    private Intent buildCaptureIntent() {
        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        android.content.ComponentName target = capture.resolveActivity(getPackageManager());
        if (target == null) return null; // 设备上没有相机应用，选择器里就不出现这一项

        File dir = SharedFileProvider.dir(this);
        // 清掉上一次残留的临时照片，避免缓存越积越多
        File[] stale = dir.listFiles();
        if (stale != null) {
            for (File old : stale) {
                if (!old.delete()) Log.w(TAG, "清理临时照片失败：" + old.getName());
            }
        }
        File photo = new File(dir, "upload-" + System.currentTimeMillis() + ".jpg");
        Uri uri = SharedFileProvider.uriFor(photo);
        pendingCameraUri = uri;

        capture.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        capture.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            grantUriPermission(target.getPackageName(), uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception error) {
            Log.w(TAG, "授予相机写入权限失败", error);
        }
        return capture;
    }

    /** 把选择结果交回网页；没有结果时必须传 null，否则那个文件输入框会一直是禁用状态。 */
    private void deliverFileChooser(Uri[] results) {
        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        Uri camera = pendingCameraUri;
        pendingCameraUri = null;
        if (camera != null) {
            try {
                revokeUriPermission(camera,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception error) {
                Log.w(TAG, "回收相机写入权限失败", error);
            }
        }
        if (callback != null) callback.onReceiveValue(results);
    }

    private void releaseFileChooser() {
        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        pendingCameraUri = null;
        if (callback != null) callback.onReceiveValue(null);
    }

    private boolean handleNavigation(String url) {
        if (url == null || url.isEmpty()) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);

        if (("http".equals(scheme) || "https".equals(scheme))) {
            boolean inSite = host.equals(ALLOWED_HOST_SUFFIX) || host.endsWith("." + ALLOWED_HOST_SUFFIX);
            if (inSite) return false;
            return openExternally(uri);
        }
        if ("weixin".equals(scheme) || "wechat".equals(scheme) || "alipays".equals(scheme)
                || "tel".equals(scheme) || "mailto".equals(scheme) || "sms".equals(scheme)) {
            return openExternally(uri);
        }
        return true;
    }

    private boolean openExternally(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            toast(getString(R.string.external_open_failed));
        }
        return true;
    }

    /** 长按图片：登录二维码可以存进相册，再用微信「扫一扫 - 相册」识别。 */
    private boolean handleLongPress() {
        WebView.HitTestResult result = webView.getHitTestResult();
        if (result != null && result.getType() == WebView.HitTestResult.IMAGE_TYPE) {
            String url = result.getExtra();
            if (url != null && !url.isEmpty()) {
                saveImageToGallery(url);
                return true;
            }
        }
        return false;
    }

    private void saveImageToGallery(String url) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingQrImageUrl = url;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_WRITE_STORAGE);
            return;
        }
        Log.i(TAG, "长按二维码，开始保存：" + url);
        toast(getString(R.string.qr_saving));
        // CookieManager 和 WebView#getSettings 只能在主线程调用，
        // 先在这里取好，再交给后台线程下载，否则会抛 WebView 线程检查异常。
        String cookie = CookieManager.getInstance().getCookie(url);
        String userAgent = webView.getSettings().getUserAgentString();
        new Thread(() -> {
            try {
                Bitmap bitmap = downloadImage(url, cookie, userAgent);
                if (bitmap == null) throw new IllegalStateException("图片解码失败");
                writeBitmap(bitmap);
                Log.i(TAG, "二维码已保存到相册");
                runOnUiThread(() -> toast(getString(R.string.qr_saved)));
            } catch (Exception error) {
                Log.w(TAG, "二维码保存失败", error);
                runOnUiThread(() -> toast(getString(R.string.qr_save_failed)));
            }
        }).start();
    }

    private Bitmap downloadImage(String url, String cookie, String userAgent) throws Exception {
        if (url.startsWith("data:image")) return decodeDataUrl(url);
        HttpURLConnection connection = (HttpURLConnection) resolveImageUrl(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        if (userAgent != null) connection.setRequestProperty("User-Agent", userAgent);
        InputStream input = connection.getInputStream();
        try {
            return BitmapFactory.decodeStream(input);
        } finally {
            input.close();
        }
    }

    /** 少数页面把二维码画成 data: URL 图片，这种情况直接解码，不走网络。 */
    private Bitmap decodeDataUrl(String url) {
        int comma = url.indexOf(',');
        if (comma < 0) throw new IllegalArgumentException("invalid data url");
        byte[] bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    /**
     * 长按命中图片时，WebView 多数情况下给出的是图片地址。
     * 少数情况下给出的是页面地址（例如背景图或 svg 包裹的图），
     * 这里做一个兜底，避免拿去下载 HTML 导致解码失败。
     */
    private URL resolveImageUrl(String raw) throws Exception {
        URL candidate = new URL(raw);
        String path = candidate.getPath() == null ? "" : candidate.getPath().toLowerCase(Locale.ROOT);
        if (!path.endsWith(".png") && !path.endsWith(".jpg") && !path.endsWith(".jpeg")
                && !path.endsWith(".webp") && !path.endsWith(".gif") && !path.contains("qrcode")) {
            Log.w(TAG, "长按命中的不是图片地址，按图片资源处理：" + raw);
        }
        return candidate;
    }

    private void writeBitmap(Bitmap bitmap) throws Exception {
        String fileName = "heya-login-qrcode-" + System.currentTimeMillis() + ".png";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/禾芽");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri target = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new IllegalStateException("insert failed");
            OutputStream output = getContentResolver().openOutputStream(target);
            try {
                if (output == null) throw new IllegalStateException("open failed");
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            } finally {
                if (output != null) output.close();
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(target, values, null, null);
            return;
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "禾芽");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("mkdir failed");
        File file = new File(dir, fileName);
        FileOutputStream output = new FileOutputStream(file);
        try {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        } finally {
            output.close();
        }
        android.media.MediaScannerConnection.scanFile(this, new String[]{file.getAbsolutePath()}, null, null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_WEB_MEDIA) {
            PermissionRequest request = pendingMediaPermission;
            pendingMediaPermission = null;
            if (request == null) return;
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
                toast(getString(R.string.mic_permission_denied));
            }
            return;
        }
        if (requestCode != REQUEST_WRITE_STORAGE) return;
        String url = pendingQrImageUrl;
        pendingQrImageUrl = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && url != null) {
            saveImageToGallery(url);
        } else {
            toast(getString(R.string.permission_denied));
        }
    }

    /**
     * 文件选择器的结果。
     * 注意两种来源长得不一样：从相册选走 data.getData()，拍照则**不通过 data 返回**，
     * 照片直接写进了我们事先给的地址。早期实现常在这里漏掉拍照这一支，
     * 表现就是"能选相册、拍了照没反应"。
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            Uri[] results = null;
            if (resultCode == RESULT_OK) {
                if (data == null || (data.getData() == null && data.getClipData() == null)) {
                    if (pendingCameraUri != null) results = new Uri[]{pendingCameraUri};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int index = 0; index < count; index++) {
                        results[index] = data.getClipData().getItemAt(index).getUri();
                    }
                } else {
                    results = new Uri[]{data.getData()};
                }
            }
            deliverFileChooser(results);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void showError(String detail) {
        errorDetail.setText(detail == null || detail.isEmpty() ? HOME_URL : detail);
        errorView.setVisibility(View.VISIBLE);
        loadingOverlay.setVisibility(View.GONE);
        progressBar.setVisibility(View.GONE);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < BACK_PRESS_INTERVAL_MS) {
            super.onBackPressed();
            return;
        }
        lastBackPressedAt = now;
        toast(getString(R.string.exit_hint));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        // 选择器还开着就退出了，回调必须收尾，否则 WebView 里的文件输入会卡在禁用态
        releaseFileChooser();
        if (webView != null && isFinishing()) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }

    /**
     * 只有一台手机（或平板）时，用户没法用同一块屏幕扫码，
     * 需要把二维码存进相册再用微信「扫一扫 → 相册」识别。
     * 登录二维码是点击「登录」之后才出现的，所以这里做一段有上限的轮询，
     * 一旦页面上出现二维码就提示一次，避免用户不知道可以长按。
     */
    private void watchForQrCode() {
        if (qrHintShown) return;
        if (qrHintWatching) return;
        qrHintWatching = true;
        qrHintChecks = 0;
        webView.postDelayed(qrHintProbe, 1500L);
    }

    private final Runnable qrHintProbe = new Runnable() {
        @Override
        public void run() {
            qrHintChecks += 1;
            if (qrHintShown || qrHintChecks > 40 || isFinishing()) {
                qrHintWatching = false;
                return;
            }
            webView.evaluateJavascript(
                    "(function(){var i=document.querySelector('img[src*=qrcode]');"
                            + "return !!i && i.offsetParent !== null && i.naturalWidth > 100;})()",
                    value -> {
                        if ("true".equals(value) && !qrHintShown) {
                            qrHintShown = true;
                            Log.i(TAG, "检测到登录二维码，提示长按保存");
                            toast(getString(R.string.qr_long_press_hint));
                        }
                    });
            webView.postDelayed(this, 2500L);
        }
    };

    private class HeYaWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl().toString());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            errorView.setVisibility(View.GONE);
            if (!firstPageFinished) {
                loadingOverlay.setVisibility(View.VISIBLE);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            firstPageFinished = true;
            loadingOverlay.setVisibility(View.GONE);
            progressBar.setVisibility(View.GONE);
            watchForQrCode();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showError(error.getDescription() == null ? "" : String.valueOf(error.getDescription()));
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (failingUrl != null && failingUrl.equals(view.getUrl())) {
                showError(description);
            }
        }
    }
}
