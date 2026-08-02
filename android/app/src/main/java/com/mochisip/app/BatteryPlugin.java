package com.mochisip.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exposes Android's battery-optimization exemption, which Capacitor core does
 * not cover. Reminders are scheduled as exact alarms, but OEM skins such as
 * MIUI, One UI and EMUI will still put the app into deep sleep and swallow
 * them unless the user grants this exemption.
 */
@CapacitorPlugin(name = "Battery")
public class BatteryPlugin extends Plugin {

    /** True when the app is already exempt, or the OS predates the feature. */
    @PluginMethod
    public void isIgnoringOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isExempt());
        call.resolve(ret);
    }

    /**
     * Opens the system exemption dialog. Falls back to the battery-optimization
     * settings list if the direct request is unavailable on this device, so the
     * user is never left with a button that silently does nothing.
     */
    @PluginMethod
    public void requestIgnoreOptimizations(PluginCall call) {
        JSObject ret = new JSObject();

        if (isExempt()) {
            ret.put("ignoring", true);
            ret.put("opened", false);
            call.resolve(ret);
            return;
        }

        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            ret.put("opened", true);
        } catch (Exception primaryFailed) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                ret.put("opened", true);
            } catch (Exception fallbackFailed) {
                ret.put("opened", false);
            }
        }

        ret.put("ignoring", isExempt());
        call.resolve(ret);
    }

    private boolean isExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) return true;
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
