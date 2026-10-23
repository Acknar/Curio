package com.acknar.curio;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * The clipper configuration (server, user, app password, default board...) as one
 * JSON object, the same shape the browser extension keeps in storage.local. Lives in
 * the app's private storage, which other apps cannot read.
 */
final class Prefs {
	private static final String FILE = "curio";
	private static final String KEY = "config";

	private Prefs() {}

	static JSONObject get(Context ctx) {
		SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
		try {
			return new JSONObject(sp.getString(KEY, "{}"));
		} catch (JSONException e) {
			return new JSONObject();
		}
	}

	/** Merges patch into the stored config; a null value removes the key. */
	static void merge(Context ctx, JSONObject patch) {
		JSONObject cur = get(ctx);
		Iterator<String> it = patch.keys();
		while (it.hasNext()) {
			String k = it.next();
			try {
				if (patch.isNull(k)) cur.remove(k);
				else cur.put(k, patch.get(k));
			} catch (JSONException ignored) {
				// keys come from the patch itself
			}
		}
		ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, cur.toString()).apply();
	}

	static String server(Context ctx) {
		return get(ctx).optString("server", "").replaceAll("/+$", "");
	}
}
