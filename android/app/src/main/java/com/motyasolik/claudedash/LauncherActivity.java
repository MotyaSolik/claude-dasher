package com.motyasolik.claudedash;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Start screen: Play, Safe mode (game without mods) and a self-updater.
 * Updates come from GitHub Pages: apk/version.json describes the newest build, apk/claude-dash.apk is the file.
 * Android installs it as an update only when the signature matches and versionCode is higher (see app/build.gradle).
 */
public class LauncherActivity extends Activity {
    private static final String BASE = "https://motyasolik.github.io/claude-dasher/apk/";
    private static final String VERSION_URL = BASE + "version.json";
    private static final String ACTION_INSTALL = "com.motyasolik.claudedash.INSTALL_RESULT";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView statusText;
    private TextView notesText;
    private Button updateButton;
    private ProgressBar progress;

    private int currentCode = 0;
    private String currentName = "?";
    private int remoteCode = 0;
    private String remoteName = "";
    private String remoteUrl = "";
    private boolean updateAvailable = false;
    private boolean busy = false;

    private final BroadcastReceiver installReceiver = new BroadcastReceiver() {
        @Override
        @SuppressWarnings("deprecation")
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirm);
                }
            } else if (status == PackageInstaller.STATUS_SUCCESS) {
                setStatus("Установлено. Открой игру заново.");
                setBusy(false);
            } else {
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                setStatus("Не удалось установить" + (msg == null ? "" : ": " + msg));
                setBusy(false);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        readCurrentVersion();
        buildUi();

        IntentFilter filter = new IntentFilter(ACTION_INSTALL);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(installReceiver, filter);
        }
        checkForUpdate();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(installReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- UI

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        return t;
    }

    private Button button(String text, int fill, int textColor) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTextColor(textColor);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(dp(14));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        return b;
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0B0F1A);
        scroll.setFillViewport(true);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(24), dp(24), dp(24), dp(24));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setLayoutParams(new LinearLayout.LayoutParams(dp(360), ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = label("CLAUDE DASH", 30, 0xFFFF7A45, true);
        title.setLetterSpacing(0.08f);
        box.addView(title);
        box.addView(label("Версия " + currentName + " (сборка " + currentCode + ")", 13, 0xFF8791BD, false));

        Button play = button("▶  Играть", 0xFFFF7A45, 0xFF25110A);
        play.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startGame(false); }
        });
        box.addView(play);

        Button safe = button("Безопасный режим (без модов)", 0xFF222B49, 0xFFEEF1FF);
        safe.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startGame(true); }
        });
        box.addView(safe);
        TextView safeHint = label("Игра запустится без модов. Если мод сломал игру, открой «Моды» и удали его.", 11, 0xFF8791BD, false);
        safeHint.setPadding(0, dp(4), 0, dp(10));
        box.addView(safeHint);

        updateButton = button("Проверить обновления", 0xFF222B49, 0xFFEEF1FF);
        updateButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onUpdateClicked(); }
        });
        box.addView(updateButton);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8));
        plp.topMargin = dp(10);
        progress.setLayoutParams(plp);
        box.addView(progress);

        statusText = label("", 13, 0xFFC8D0F5, false);
        statusText.setPadding(0, dp(10), 0, 0);
        box.addView(statusText);
        notesText = label("", 11, 0xFF8791BD, false);
        notesText.setPadding(0, dp(4), 0, 0);
        box.addView(notesText);

        col.addView(box);
        scroll.addView(col, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
    }

    private void setStatus(final String s) {
        ui.post(new Runnable() { @Override public void run() { statusText.setText(s); } });
    }

    private void setBusy(final boolean b) {
        busy = b;
        ui.post(new Runnable() {
            @Override public void run() {
                updateButton.setEnabled(!busy);
                updateButton.setAlpha(busy ? 0.5f : 1f);
                if (!busy) progress.setVisibility(View.GONE);
            }
        });
    }

    // ---------------------------------------------------------------- start

    private void startGame(boolean safe) {
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("safe", safe);
        startActivity(i);
    }

    // ---------------------------------------------------------------- update

    @SuppressWarnings("deprecation")
    private void readCurrentVersion() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            currentName = pi.versionName == null ? "?" : pi.versionName;
            currentCode = Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception ignored) { }
    }

    private void onUpdateClicked() {
        if (busy) return;
        if (updateAvailable) downloadAndInstall(); else checkForUpdate();
    }

    private void checkForUpdate() {
        if (busy) return;
        setBusy(true);
        setStatus("Проверяю обновления…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String json = httpGetString(VERSION_URL + "?t=" + System.currentTimeMillis());
                    JSONObject o = new JSONObject(json);
                    remoteCode = o.getInt("versionCode");
                    remoteName = o.optString("versionName", String.valueOf(remoteCode));
                    remoteUrl = o.getString("url");
                    final String notes = o.optString("notes", "");
                    if (!remoteUrl.startsWith(BASE)) throw new Exception("адрес обновления не из доверенного места");
                    updateAvailable = remoteCode > currentCode;
                    ui.post(new Runnable() {
                        @Override public void run() {
                            if (updateAvailable) {
                                updateButton.setText("Обновить до " + remoteName);
                                statusText.setText("Доступна новая версия: " + remoteName);
                                notesText.setText(notes);
                            } else {
                                updateButton.setText("Проверить обновления");
                                statusText.setText("У тебя последняя версия");
                                notesText.setText("");
                            }
                        }
                    });
                } catch (Exception e) {
                    setStatus("Не удалось проверить обновления (нет сети или сайт недоступен)");
                }
                setBusy(false);
            }
        }).start();
    }

    private void downloadAndInstall() {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            setStatus("Разреши этому приложению устанавливать обновления, потом вернись и нажми кнопку снова.");
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
            startActivity(i);
            return;
        }
        setBusy(true);
        ui.post(new Runnable() { @Override public void run() { progress.setProgress(0); progress.setVisibility(View.VISIBLE); } });
        setStatus("Скачиваю " + remoteName + "…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    File f = new File(getCacheDir(), "update.apk");
                    download(remoteUrl, f);
                    setStatus("Устанавливаю…");
                    install(f);
                } catch (Exception e) {
                    setStatus("Ошибка обновления: " + e.getMessage());
                    setBusy(false);
                }
            }
        }).start();
    }

    private String httpGetString(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 65536) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    private void download(String url, File dest) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url + "?t=" + System.currentTimeMillis()).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            final long total = c.getContentLength();
            InputStream in = c.getInputStream();
            OutputStream out = new FileOutputStream(dest);
            byte[] buf = new byte[16384];
            long done = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    final int pct = (int) (done * 100 / total);
                    ui.post(new Runnable() { @Override public void run() { progress.setProgress(pct); } });
                }
            }
            out.close();
            in.close();
            if (dest.length() < 100000) throw new Exception("файл слишком маленький, обновление повреждено");
        } finally {
            c.disconnect();
        }
    }

    private void install(File apk) throws Exception {
        PackageInstaller installer = getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(id);
        try {
            InputStream in = new java.io.FileInputStream(apk);
            OutputStream out = session.openWrite("claudedash", 0, apk.length());
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
            in.close();
            out.close();
            Intent intent = new Intent(ACTION_INSTALL);
            intent.setPackage(getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(this, id, intent, flags);
            session.commit(pending.getIntentSender());
        } finally {
            session.close();
        }
    }
}
