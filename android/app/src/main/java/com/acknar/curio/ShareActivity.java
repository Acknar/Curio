package com.acknar.curio;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The share target ("Share > Add to Curio" from Instagram, Pinterest, a browser,
 * the gallery...). Turns the incoming intent into a plain payload for
 * assets/ui/clip.html, which does the extraction and the upload.
 */
public class ShareActivity extends WebShellActivity {
	private final List<Uri> files = new ArrayList<>();
	private JSONObject payload = new JSONObject();

	@Override
	protected String page() {
		return "ui/clip.html";
	}

	@Override
	protected boolean transparent() {
		return true;
	}

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		payload = readIntent(getIntent());
		super.onCreate(savedInstanceState);
	}

	private JSONObject readIntent(Intent intent) {
		JSONObject o = new JSONObject();
		try {
			o.put("action", intent.getAction());
			o.put("type", intent.getType());
			if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
				CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
				o.put("text", t == null ? "" : t.toString());
				o.put("processText", true);
			} else {
				CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
				o.put("text", text == null ? "" : text.toString());
				String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
				o.put("subject", subject == null ? "" : subject);
				String title = intent.getStringExtra(Intent.EXTRA_TITLE);
				o.put("title", title == null ? "" : title);
			}
			Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
			if (stream == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
				stream = intent.getClipData().getItemAt(0).getUri();
			}
			JSONArray arr = new JSONArray();
			if (stream != null) {
				files.add(stream);
				arr.put(describe(0, stream));
			}
			o.put("files", arr);
		} catch (JSONException ignored) {
			// string values only
		}
		return o;
	}

	private JSONObject describe(int index, Uri uri) throws JSONException {
		JSONObject f = new JSONObject();
		ContentResolver cr = getContentResolver();
		String name = uri.getLastPathSegment();
		long size = -1;
		try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
			if (c != null && c.moveToFirst()) {
				int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
				int s = c.getColumnIndex(OpenableColumns.SIZE);
				if (n >= 0 && !c.isNull(n)) name = c.getString(n);
				if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
			}
		} catch (Exception ignored) {
			// some providers refuse metadata queries
		}
		String mime = cr.getType(uri);
		f.put("index", index);
		f.put("name", name == null ? "shared" : name);
		f.put("mime", mime == null ? getIntent().getType() : mime);
		f.put("size", size);
		f.put("uri", uri.toString());
		return f;
	}

	@Override
	JSONObject sharedPayload() {
		return payload;
	}

	@Override
	Http.SharedSource sharedSource() {
		return (index, mimeOut) -> {
			if (index < 0 || index >= files.size()) throw new FileNotFoundException("No shared file " + index);
			Uri uri = files.get(index);
			String mime = getContentResolver().getType(uri);
			if (mime != null) mimeOut[0] = mime;
			InputStream in = getContentResolver().openInputStream(uri);
			if (in == null) throw new FileNotFoundException(uri.toString());
			return in;
		};
	}

	@Override
	public void finish() {
		super.finish();
		overridePendingTransition(0, android.R.anim.fade_out);
	}
}
