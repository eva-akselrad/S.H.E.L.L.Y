package com.evaakselrad.shelly.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.evaakselrad.shelly.GlanceParser
import com.evaakselrad.shelly.MainActivity
import com.evaakselrad.shelly.Prefs
import com.evaakselrad.shelly.R
import com.evaakselrad.shelly.Refresh

/**
 * Home-screen widget. It never touches the network: it paints the last /api/glance that
 * RefreshWorker saved. Small (about 2x1) and wide (about 4x2) layouts, chosen by the widget's size.
 */
class ShellyWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) update(context, manager, id, manager.getAppWidgetOptions(id))
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        update(context, manager, id, newOptions)
    }

    /** First widget placed: make sure data is flowing. */
    override fun onEnabled(context: Context) {
        Refresh.schedulePeriodic(context)
        Refresh.enqueueNow(context, expedited = false)
    }

    companion object {
        /** Wide layout from about 4 cells across and 2 down. */
        private const val WIDE_MIN_WIDTH_DP = 180
        private const val WIDE_MIN_HEIGHT_DP = 90

        fun updateAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, ShellyWidgetProvider::class.java))
            for (id in ids) update(context, mgr, id, mgr.getAppWidgetOptions(id))
        }

        private fun update(context: Context, mgr: AppWidgetManager, id: Int, options: Bundle) {
            val wide = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) >= WIDE_MIN_WIDTH_DP &&
                options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) >= WIDE_MIN_HEIGHT_DP
            val glance = Prefs(context).lastGlance?.let { GlanceParser.parse(it) }
            val m = WidgetModel.from(glance, System.currentTimeMillis())
            mgr.updateAppWidget(id, render(context, m, wide))
        }

        private fun color(context: Context, res: Int) = ContextCompat.getColor(context, res)

        fun render(context: Context, m: WidgetModel, wide: Boolean): RemoteViews {
            val v = RemoteViews(context.packageName, if (wide) R.layout.widget_wide else R.layout.widget_small)
            val alert = m.look != Look.NORMAL
            val ink = if (alert) color(context, R.color.w_on_alert) else color(context, R.color.w_ink)
            val muted = if (alert) color(context, R.color.w_on_alert) else color(context, R.color.w_muted)

            v.setInt(
                R.id.w_root,
                "setBackgroundResource",
                when (m.look) {
                    Look.WARNING -> R.drawable.widget_bg_warning
                    Look.ELEVATED -> R.drawable.widget_bg_elevated
                    Look.NORMAL -> R.drawable.widget_bg
                },
            )
            v.setImageViewResource(R.id.w_icon, iconRes(m.icon))
            // on the red and amber backgrounds the icon is drawn all white so it stays readable
            v.setInt(R.id.w_icon, "setColorFilter", if (alert) color(context, R.color.w_on_alert) else 0)

            // small layout in a warning: the alert name replaces the temperature
            val alertInSmall = !wide && m.look == Look.WARNING && m.alertName != null
            v.setTextViewText(R.id.w_temp, if (alertInSmall) m.alertName else m.temp)
            v.setTextColor(R.id.w_temp, ink)
            v.setTextViewTextSize(R.id.w_temp, android.util.TypedValue.COMPLEX_UNIT_SP, if (wide) 44f else if (alertInSmall) 14f else 28f)

            v.setTextViewText(R.id.w_footer, if (wide) m.footer else m.smallFooter)
            v.setTextColor(R.id.w_footer, muted)
            if (wide) {
                v.setTextViewText(R.id.w_desc, m.desc)
                v.setTextColor(R.id.w_desc, ink)
                v.setTextViewText(R.id.w_hilo, m.hilo)
                v.setTextColor(R.id.w_hilo, muted)
                v.setTextViewText(R.id.w_line, m.line)
                v.setTextColor(R.id.w_line, ink)
            }

            val open = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            v.setOnClickPendingIntent(R.id.w_root, open)
            return v
        }

        private fun iconRes(key: String): Int = when (key) {
            "sun" -> R.drawable.w_sun
            "moon" -> R.drawable.w_moon
            "partly" -> R.drawable.w_partly
            "cloud" -> R.drawable.w_cloud
            "fog" -> R.drawable.w_fog
            "drizzle" -> R.drawable.w_drizzle
            "rain" -> R.drawable.w_rain
            "snow" -> R.drawable.w_snow
            "sleet" -> R.drawable.w_sleet
            "storm" -> R.drawable.w_storm
            else -> R.drawable.w_unknown
        }
    }
}
