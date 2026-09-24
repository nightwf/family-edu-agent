package top.heyaagent.familyedu;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * 「拍照上传」用到的文件共享入口。
 *
 * 系统相机要求通过 EXTRA_OUTPUT 拿到一个 content:// 地址：Android 7 起直接传
 * file:// 会抛 FileUriExposedException，所以必须有这么一个 Provider。
 * 为了一个功能引入整套 AndroidX 不划算，这里自己实现最小的一个：
 * 只暴露应用缓存目录下的 shared/ 一层，且只认单层文件名，杜绝路径穿越。
 *
 * 页面里的「插一张照片」走的就是这里：拍照 → 写入 shared/ → 把地址交回网页。
 */
public class SharedFileProvider extends ContentProvider {

    static final String AUTHORITY = "top.heyaagent.familyedu.files";
    private static final String DIR_NAME = "shared";

    /** 拍照输出固定放在缓存目录，不占用户相册，系统清理缓存时也会一并回收。 */
    static File dir(Context context) {
        File target = new File(context.getCacheDir(), DIR_NAME);
        if (!target.exists() && !target.mkdirs()) {
            // 交给 openFile 时报错，这里不吞掉信息
            android.util.Log.w("HeYaApp", "创建共享目录失败：" + target);
        }
        return target;
    }

    static Uri uriFor(File file) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(file.getName()).build();
    }

    @Override
    public boolean onCreate() {
        Context context = getContext();
        if (context != null) dir(context);
        return true;
    }

    /**
     * 相机要往这个地址写照片，网页要读它，所以读写都要放行。
     * 路径先做白名单校验，只允许 shared/ 下的单层文件名。
     */
    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File target = fileFor(uri);
        int flags = ParcelFileDescriptor.MODE_READ_ONLY;
        if (mode != null && mode.contains("w")) {
            flags = ParcelFileDescriptor.MODE_READ_WRITE
                    | ParcelFileDescriptor.MODE_CREATE
                    | ParcelFileDescriptor.MODE_TRUNCATE;
        }
        return ParcelFileDescriptor.open(target, flags);
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null) return "application/octet-stream";
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
        return "application/octet-stream";
    }

    /** WebView 上传时会问文件名和大小，缺了这两项部分机型会拿不到文件。 */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File target;
        try {
            target = fileFor(uri);
        } catch (FileNotFoundException error) {
            return null;
        }
        MatrixCursor cursor = new MatrixCursor(
                new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[]{target.getName(), target.length()});
        return cursor;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        try {
            File target = fileFor(uri);
            return target.delete() ? 1 : 0;
        } catch (FileNotFoundException error) {
            return 0;
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("不支持新增");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("不支持修改");
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null) throw new FileNotFoundException("上下文不可用");
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()
                || name.contains("/") || name.contains("\\") || name.contains("..")) {
            throw new FileNotFoundException("非法文件名：" + uri);
        }
        File base = dir(context);
        File target = new File(base, name);
        // 再核一次真实路径确实落在目录内，避免任何形式的越界
        try {
            if (!target.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator)) {
                throw new FileNotFoundException("路径越界：" + uri);
            }
        } catch (IOException error) {
            throw new FileNotFoundException("路径解析失败：" + uri);
        }
        return target;
    }
}
