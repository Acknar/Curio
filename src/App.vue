<template>
	<div class="curio" :class="{ 'nav-hidden': !navOpen }" :data-rbtheme="theme">
		<!-- First-run folder setup: shown until the user creates or picks a base folder -->
		<div v-if="needsSetup" class="scrim show setup-scrim">
			<div class="modal show" style="width:min(500px,94vw)">
				<div class="mhead"><h2>{{ folderConfigured ? tr('Choose your Curio folder') : tr('Welcome to Curio') }}</h2></div>
				<div class="mbody">
					<p v-if="folderConfigured" style="margin:0 0 14px">{{ tr('Your Curio folder could not be found. Create a new one or pick an existing folder to continue.') }}</p>
					<p v-else style="margin:0 0 14px">{{ tr('Choose where Curio keeps your boards in your Nextcloud Files. Each board becomes a folder inside it, and any folder you drop in there shows up as a board.') }}</p>
					<template v-if="!browseOpen">
						<div class="field"><label>{{ tr('Create a new folder') }}</label>
							<div class="setup-create">
								<input ref="setupNameField" v-model="setupName" :placeholder="tr('Folder name')" :disabled="setupBusy" @keydown.enter="submitCreateFolder">
								<button class="btn primary" :disabled="setupBusy || !setupName.trim()" @click="submitCreateFolder">{{ tr('Create') }}</button>
							</div>
							<div class="hint" style="margin-top:4px">{{ tr('Created at the top level of your Files.') }}</div>
						</div>
						<div class="setup-or"><span>{{ tr('or') }}</span></div>
						<button class="btn setup-pick" :disabled="setupBusy" @click="openBrowse"><span v-html="icon('folder', 16)" />{{ tr('Choose an existing folder') }}</button>
					</template>
					<template v-else>
						<div class="field"><label>{{ tr('Pick a folder') }}</label>
							<div class="brw-path">{{ browsePath ? '/ ' + browsePath.split('/').join(' / ') : tr('All files') }}</div>
							<div class="brw-list">
								<button v-if="browseParent !== null" class="brw-row up" :disabled="browseBusy" @click="browseTo(browseParent)"><span v-html="icon('chevron', 15)" />{{ tr('Up one level') }}</button>
								<button v-for="f in browseList" :key="f.path" class="brw-row" :disabled="browseBusy" @click="browseTo(f.path)"><span v-html="icon('folder', 15)" />{{ f.name }}</button>
								<div v-if="!browseList.length && !browseBusy" class="brw-empty">{{ tr('No subfolders here.') }}</div>
							</div>
						</div>
						<div class="setup-foot">
							<button class="btn" :disabled="setupBusy" @click="browseOpen = false">{{ tr('Back') }}</button>
							<button class="btn primary" :disabled="setupBusy || !browsePath" @click="chooseCurrentFolder">{{ browsePath ? tr('Use "{name}"', { name: browsePath.split('/').pop() }) : tr('Use this folder') }}</button>
						</div>
					</template>
					<div v-if="setupError" class="setup-err">{{ setupError }}</div>
				</div>
			</div>
		</div>
		<div v-if="navOpen && isMobile" class="side-backdrop" @click="navOpen = false" />
		<button class="side-handle" :title="tr('Toggle sidebar')" @click="navOpen = !navOpen" v-html="icon('chevron', 18)" />

		<aside class="sidebar">
			<div class="side-fixed">
				<div class="side-top">
					<div class="searchwrap" :class="{ has: !!search }">
						<input v-model="search" :placeholder="tr('Search here ...')">
						<button v-if="search" class="sx" @click="search = ''" v-html="icon('x', 14)" />
						<span class="si" v-html="icon('search', 15)" />
					</div>
				</div>
				<button class="addbtn" @click="openAdd"><span v-html="icon('image', 16)" /> {{ tr('Add reference') }}</button>
			</div>

			<div class="side-scroll">
				<div class="side-section">
					<div class="side-head">
						<span class="htitle">{{ tr('Filter by tag') }}</span>
						<button v-if="shownTags.length" class="clr" @click="shownTags = []">{{ tr('Clear') }}</button>
						<button class="hbtn" :title="tr('New folder')" @click="newFolder" v-html="icon('plus', 15)" />
						<button class="hbtn" :title="tr('Manage tags & folders')" @click="manageTagsOpen = true" v-html="icon('dots', 16)" />
					</div>
					<div v-for="f in folders" :key="'f' + f.id">
						<div class="folderrow" @click="toggleFolderExpand(f)">
							<button class="chev" :class="{ open: f.expanded }" v-html="icon('chevron', 18)" />
							<span class="fname">{{ f.name }}</span>
							<button class="fadd" :title="tr('New tag in this folder')" @click.stop="openTagModal(null, f.id)" v-html="icon('plus', 14)" /><span class="fcount">{{ tagsInFolder(f.id).length }}</span>
							<button v-if="tagsInFolder(f.id).length" class="eye" :class="folderShown(tagsInFolder(f.id)) ? 'on' : 'off'" :title="tr('Show/hide all tags in this folder')" @click.stop="toggleFolder(tagsInFolder(f.id))" v-html="icon(folderShown(tagsInFolder(f.id)) ? 'eye' : 'eyeoff')" />
						</div>
						<div v-if="f.expanded" class="foldertags">
							<div v-if="!tagsInFolder(f.id).length" class="hint" style="padding:2px 6px">{{ tr('No tags.') }}</div>
							<div v-for="t in tagsInFolder(f.id)" :key="'t' + t.id" class="navrow tagrow" :class="{ shown: shownTags.includes(t.name) }" draggable="true" @dragstart="onTagDragStart($event, t)" @dragend="onTagDragEnd">
								<button class="tagcircle" :style="{ background: t.color }" :title="tr('Change colour')" @click.stop="openTagModal(t)" />
								<span class="label" @click="toggleTag(t.name)">{{ t.name }}</span>
								<span class="count">{{ tagRefCount(t.name) }}</span>
								<button class="eye" :class="shownTags.includes(t.name) ? 'on' : 'off'" @click.stop="toggleTag(t.name)" v-html="icon(shownTags.includes(t.name) ? 'eye' : 'eyeoff')" />
							</div>
						</div>
					</div>
					<template v-if="ungroupedTags.length">
						<div class="folderrow" @click="ungroupedOpen = !ungroupedOpen"><button class="chev" :class="{ open: ungroupedOpen }" v-html="icon('chevron', 18)" /><span class="fname">{{ tr('Ungrouped') }}</span><button class="fadd" :title="tr('New tag')" @click.stop="openTagModal(null, null)" v-html="icon('plus', 14)" /><span class="fcount">{{ ungroupedTags.length }}</span><button class="eye" :class="folderShown(ungroupedTags) ? 'on' : 'off'" :title="tr('Show/hide all ungrouped tags')" @click.stop="toggleFolder(ungroupedTags)" v-html="icon(folderShown(ungroupedTags) ? 'eye' : 'eyeoff')" /></div>
						<div v-if="ungroupedOpen" class="foldertags">
							<div v-for="t in ungroupedTags" :key="'t' + t.id" class="navrow tagrow" :class="{ shown: shownTags.includes(t.name) }" draggable="true" @dragstart="onTagDragStart($event, t)" @dragend="onTagDragEnd">
								<button class="tagcircle" :style="{ background: t.color }" :title="tr('Change colour')" @click.stop="openTagModal(t)" />
								<span class="label" @click="toggleTag(t.name)">{{ t.name }}</span>
								<span class="count">{{ tagRefCount(t.name) }}</span>
								<button class="eye" :class="shownTags.includes(t.name) ? 'on' : 'off'" @click.stop="toggleTag(t.name)" v-html="icon(shownTags.includes(t.name) ? 'eye' : 'eyeoff')" />
							</div>
						</div>
					</template>
					<div v-if="!folders.length && !ungroupedTags.length" class="hint" style="padding:4px 6px">{{ tr('No tags yet.') }}</div>
				</div>

				<div class="side-section">
					<div class="side-head"><span class="htitle">{{ tr('Boards') }}</span>
						<button class="hbtn" :title="tr('New board')" @click="newBoard" v-html="icon('plus', 15)" />
						<button class="hbtn" :title="tr('Manage boards')" @click="manageBoardsOpen = true" v-html="icon('dots', 16)" />
					</div>
					<div v-for="b in sortedBoards" :key="'b' + b.id" class="navrow boardrow" :class="{ current: isSolo(b) }">
						<span v-if="b.mine" class="dot" :style="{ background: b.color }" />
						<span v-else class="owner-av" :style="{ background: b.color }">{{ init(b.ownerDisplayName) }}</span>
						<span class="label" @click="soloBoard(b)">{{ b.name }}</span>
						<span class="count">{{ refCountForBoard(b.id) }}</span>
						<button class="eye" :class="b.visible ? 'on' : 'off'" @click.stop="b.visible = !b.visible" v-html="icon(b.visible ? 'eye' : 'eyeoff')" />
					</div>
				</div>
			</div>

			<div class="side-footer"><button @click="openSettings"><span v-html="icon('sliders', 16)" /> {{ tr('Settings') }}</button></div>
		</aside>

		<main class="main" ref="mainScroll" @scroll="onGridScroll" @dragover.prevent="onMainDragOver" @dragenter.prevent="onMainDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
			<div v-if="dragOver" class="dropoverlay"><div class="dropbox"><span v-html="icon('image', 40)" /><p>{{ tr('Drop an image or a link to add it') }}</p></div></div>
			<div class="toolbar">
				<h1>{{ viewTitle }}</h1>
				<div class="spacer" />
				<button class="icon-btn" :class="{ active: settings.labels }" :title="tr('Always show titles & tags')" @click="toggleLabels"><b style="font-size:13px">Aa</b></button>
				<div class="typefilter">
					<button class="icon-btn" :class="{ active: filterTypes.length }" :title="tr('Filter by type')" @click.stop="typeMenuOpen = !typeMenuOpen" v-html="icon('filter', 16)" />
					<div v-if="typeMenuOpen" class="typemenu" @click.stop>
						<div class="tm-row" :class="{ sel: !filterTypes.length }" @click="filterTypes = []; typeMenuOpen = false"><span class="tm-check">{{ !filterTypes.length ? '✓' : '' }}</span><span class="tm-name">{{ tr('All types') }}</span></div>
						<div v-for="t in presentTypes" :key="t.type" class="tm-row" :class="{ sel: filterTypes.includes(t.type) }" @click="toggleType(t.type)"><span class="tm-check">{{ filterTypes.includes(t.type) ? '✓' : '' }}</span><span class="tm-ic" v-html="typeIcon(t.type)" /><span class="tm-name">{{ t.name }}</span><span class="tm-count">{{ t.count }}</span></div>
					</div>
				</div>
				<div class="segmented">
					<button :class="{ active: settings.layout === 'square' }" :title="tr('Grid')" @click="setLayout('square')"><svg width="15" height="15" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1.3" /><rect x="9" y="1" width="6" height="6" rx="1.3" /><rect x="1" y="9" width="6" height="6" rx="1.3" /><rect x="9" y="9" width="6" height="6" rx="1.3" /></svg></button>
					<button :class="{ active: settings.layout === 'masonry' }" :title="tr('Dynamic vertical')" @click="setLayout('masonry')"><svg width="15" height="15" viewBox="0 0 16 16"><rect x="1.5" y="1" width="5.5" height="9.5" rx="1.3" /><rect x="9" y="4.5" width="5.5" height="10.5" rx="1.3" /></svg></button>
					<button :class="{ active: settings.layout === 'hmasonry' }" :title="tr('Dynamic horizontal')" @click="setLayout('hmasonry')"><svg width="15" height="15" viewBox="0 0 16 16"><rect x="1" y="1.5" width="9.5" height="5.5" rx="1.3" /><rect x="4.5" y="9" width="10.5" height="5.5" rx="1.3" /></svg></button>
					<button :class="{ active: settings.layout === 'map' }" :title="tr('Map')" @click="setLayout('map')"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1 3.5 5.5 2 10.5 3.5 15 2v10.5L10.5 14 5.5 12.5 1 14z"/><path d="M5.5 2v10.5M10.5 3.5V14"/></svg></button>
				</div>
			</div>

			<div v-if="loading" class="empty"><p>{{ tr('Loading...') }}</p></div>
			<div v-else-if="error" class="empty"><p>{{ error }}</p></div>
			<div v-else-if="settings.layout === 'map'" class="rb-map-wrap">
				<div ref="mapEl" class="rb-map"></div>
				<div v-if="!locatedRefs.length" class="rb-map-empty"><span v-html="icon('pin', 34)" /><p>{{ tr('No references have a location yet. Add one from a reference\'s Location section.') }}</p></div>
			</div>
			<div v-else class="grid" :class="[gridClass, { 'show-labels': settings.labels }]">
				<div v-if="!filteredRefs.length" class="empty">
					<div class="big" v-html="icon('folder', 44)" />
					<p>{{ emptyMessage }}</p>
				</div>
				<div v-for="r in sortedRefs" :key="r.id" :data-rid="r.id" class="card" :class="cardClass(r)" :style="cardStyle(r)" @click="openDetail(r)" @dragover="onCardDragOver($event)" @drop="onCardDrop($event, r)">
					<div class="checkbox" @click.stop="toggleSelect(r)" v-html="icon('check', 15)" />
					<div v-if="!isText(r) && sourceLabel(r)" class="domainchip"><span class="fav" :style="{ background: grad(r.seed * 2) }" /><span class="d">{{ sourceLabel(r) }}</span></div>
					<div class="typebadge" v-html="typeIcon(r.type)" />
					<div v-if="!boardMine(r)" class="owner-badge" :style="{ background: ownerColor(r) }" :title="ownerName(r)">{{ init(ownerName(r)) }}</div>
					<template v-if="isText(r)">
						<div class="tnote md" v-html="md(r.body)" />
					</template>
					<template v-else>
						<div class="thumb" :style="thumbStyle(r)"><img v-if="hasThumb(r)" class="thumbimg" :src="thumbUrl(r)" loading="lazy" @load="onImgLoad($event, r)" @error="onImgError($event, r)"></div>
						<div v-if="r.type === 'video' && !isIgVideo(r)" class="playbadge" v-html="play(22)" />
					</template>
					<div class="overlay">
						<div class="ov-title">{{ r.title }}</div>
						<div class="ov-tags"><span v-for="t in r.tags" :key="t.name" class="pill" :style="{ background: t.color, color: on(t.color) }">{{ t.name }}</span></div>
					</div>
				</div>
			</div>
			<div v-if="!loading && !error" class="footnote">{{ tr('Showing {n} of {total} references', { n: sortedRefs.length, total: visibleRefs.length }) }}<span v-if="shownTags.length"> {{ tr('· tags:') }} {{ shownTags.join(', ') }}</span></div>
		</main>

		<div v-if="scrollIndex.length > 1 && scrollable" class="scrollindex" :class="{ active: siActive }" @click.stop>
			<div v-for="m in scrollIndex" :key="m.key" class="si-mark" :class="{ cur: m.key === currentIndexKey }" :title="m.label" @click.stop.prevent="jumpToIndex(m)"><span class="si-lbl">{{ m.label }}</span><span class="si-dot" /></div>
		</div>

		<div v-show="selected.length" class="actionbar" :class="{ show: selected.length }">
			<span class="selcount">{{ tr('{n} selected', { n: selected.length }) }}</span>
			<button class="abtn primary" @click="openBulk" v-html="icon('tag', 15) + ' ' + tr('Add tags')" />
			<button class="abtn danger" @click="deleteSelected" v-html="icon('trash', 15) + ' ' + tr('Delete')" />
			<button class="abtn ghost" @click="clearSelection">{{ tr('Clear') }}</button>
		</div>

		<!-- Add reference modal -->
		<div v-if="addOpen" class="scrim show" @click.self="closeAdd" @dragover.prevent @drop.prevent>
			<div class="modal show">
				<div class="mhead"><h2>{{ tr('Add reference') }}</h2><button class="close" @click="closeAdd" v-html="icon('x', 18)" /></div>
				<div class="tabs">
					<button v-for="t in addTabs" :key="t.k" class="tab" :class="{ active: addTab === t.k }" @click="setTab(t.k)">{{ tr(t.label) }}</button>
				</div>
				<div class="mbody">
					<template v-if="addTab === 'link'">
						<div class="field"><label>{{ tr('URL') }}</label>
							<div class="urlrow"><input ref="addUrlField" v-model="addUrl" :placeholder="tr('Paste any link: web page, image, video or PDF')" @keydown.enter.prevent="doFetch"><button class="btn" :disabled="fetching || !addUrl" @click="doFetch">{{ fetching ? tr('Fetching...') : tr('Fetch') }}</button></div>
						</div>
						<div class="hint">{{ tr('Curio detects the type, pulls the title and preview, and downloads images, videos and PDFs. For a web page it saves the page\'s image and keeps the link.') }}</div>
					</template>
					<template v-else-if="addTab === 'upload'">
						<div class="field"><label>{{ tr('Upload') }}</label>
							<label class="dropzone" :class="{ busy: uploading, dragover: uploadDragOver }" @dragover.prevent="uploadDragOver = true" @dragenter.prevent="uploadDragOver = true" @dragleave.prevent="uploadDragOver = false" @drop.prevent="onUploadDrop">
								<input type="file" accept="image/*,application/pdf" style="display:none" @change="onUploadPick">
								<span v-if="uploading">{{ tr('Uploading...') }}</span>
								<span v-else-if="addUploadMarker">{{ tr('File uploaded. Click to choose another.') }}</span>
								<span v-else>{{ tr('Click or drop an image or PDF to upload.') }}</span>
							</label>
						</div>
					</template>
					<template v-else>
						<div class="field"><label>{{ tr('Text') }}</label>
							<div v-if="textEditorReady" ref="addSlot" class="rb-texteditor add" />
							<textarea v-else v-model="addBody" :placeholder="tr('Write markdown...')" style="min-height:120px" />
						</div>
					</template>

					<div v-if="addTab !== 'text' && (addImg || fetchMsg)" class="fetchprev">
						<div v-if="addImg" class="fetchprev-img">
							<img :src="addImg" @error="addImg = null">
							<button class="crop-pencil" title="Crop image" @click="openCrop" v-html="icon('edit', 14)" />
						</div>
						<span v-if="fetchMsg" class="fetchmsg">{{ fetchMsg }}</span>
					</div>
					<div v-if="addTab !== 'text' && addImages.length > 1" class="imgpick">
						<div class="imgpick-lbl">{{ tr('Choose the image to import:') }}</div>
						<div class="imgpick-row">
							<button v-for="(u, i) in addImages" :key="i" class="imgpick-thumb" :class="{ sel: addImg === u }" @click="pickImage(u)"><img :src="u" @error="dropImage(u)"></button>
						</div>
					</div>
					<div class="field"><label>{{ tr('Board') }}</label>
						<select v-model="addBoardId" class="rb-select"><option v-for="b in boards.filter(x => x.mine)" :key="b.id" :value="b.id">{{ b.name }}</option></select>
					</div>
					<div class="field"><label>{{ tr('Title') }}</label><input v-model="addTitle" :placeholder="titlePlaceholder"></div>
					<div v-if="addTab !== 'text'" class="field"><label>{{ tr('Description') }}</label><textarea v-model="addDesc" :placeholder="tr('Optional description')" /></div>
					<div v-if="addTab !== 'text'" class="field"><label>{{ tr('Location') }}</label>
						<div v-if="addGeo" class="geo-detected"><span v-html="icon('pin', 14)" /> <span class="geo-detected-txt">{{ addGeo.place || (Number(addGeo.lat).toFixed(4) + ', ' + Number(addGeo.lng).toFixed(4)) }}</span><button class="geo-detected-x" :title="tr('Clear location')" @click="addGeo = null" v-html="icon('x', 13)" /></div>
						<div class="geo-search addgeo-search">
							<input v-model="addGeoQuery" :placeholder="addGeo ? tr('Change location...') : tr('Search a place or address...')" @input="onAddGeoInput" @keydown.enter.prevent="pickFirstAddGeo" @blur="onAddGeoBlur">
							<div v-if="addGeoSug.length" class="tagsug geo-sug">
								<div v-for="(s, i) in addGeoSug" :key="i" class="tagsug-row" @mousedown.prevent="pickAddGeoSug(s)"><span class="geo-sug-ic" v-html="icon('pin', 13)" /><span class="geo-sug-txt">{{ s.place }}</span></div>
							</div>
						</div>
						<div v-if="addGeoBusy && !addGeoSuggestions.length" class="hashsug" style="margin-top:6px"><span class="hashsug-lbl">{{ tr('Detecting location…') }}</span></div>
						<div v-if="addGeoSuggestions.length" class="hashsug" style="margin-top:6px"><span class="hashsug-lbl">{{ addGeoSuggestions.length > 1 ? tr('Suggested places:') : tr('Suggested:') }}</span><button v-for="(s, i) in addGeoSuggestions" :key="i" class="hashsug-chip" :class="{ 'hashsug-chip-on': isAddGeoSelected(s) }" :title="s.place" @click="acceptAddGeoSuggestion(s)"><span v-html="icon('pin', 12)" /> {{ suggestionShort(s) }}</button></div>
					</div>
					<div class="field">
						<label>{{ tr('Tags') }}</label>
						<div class="taginput-wrap">
							<div class="taginput">
								<span v-for="(t, i) in addTags" :key="t.id" class="tgpill" :style="{ background: t.color, color: on(t.color) }">{{ t.name }} <span class="x" @click="addTags.splice(i, 1)">✕</span></span>
								<input v-model="addTagInput" :placeholder="tr('Add tags, Enter...')" @keydown.enter.prevent="commitAddTag">
							</div>
							<div v-if="addTagInput.trim() && addTagSuggestions.length" class="tagsug">
								<div v-for="t in addTagSuggestions" :key="t.id" class="tagsug-row" @mousedown.prevent="pickAddTag(t)"><span class="tagsug-c" :style="{ background: t.color }" />{{ t.name }}</div>
							</div>
						</div>
						<div v-if="addHashtags.length" class="hashsug"><span class="hashsug-lbl">{{ tr('From caption:') }}</span><button v-for="h in addHashtags" :key="h" class="hashsug-chip" @click="addHashtag(h)">#{{ h }}</button></div>
					</div>
				</div>
				<div class="mfoot">
					<template v-if="addWarn">
						<span class="fetchwarn">{{ tr('Add without fetching a preview?') }}</span>
						<button class="btn" @click="addAnyway">{{ tr('Add anyway') }}</button>
						<button class="btn primary" @click="fetchNow">{{ tr('Fetch now') }}</button>
					</template>
					<template v-else>
						<button class="btn" @click="closeAdd">{{ tr('Cancel') }}</button>
						<button class="btn primary" :disabled="adding || uploading" @click="doAdd">{{ tr('Add to board') }}</button>
					</template>
				</div>
			</div>
		</div>

		<!-- Detail modal -->
		<div v-if="detailOpen && detailRef" class="scrim show" @click.self="closeDetail">
			<div class="modal detail show" :class="{ fs: detailFs }">
				<div class="detail-wrap">
					<div class="detail-media">
						<button class="mediabtn expand" :title="detailFs ? tr('Exit full screen') : tr('Full screen')" @click="detailFs = !detailFs" v-html="icon(detailFs ? 'minimize' : 'maximize', 18)" />
						<button class="mediabtn closef" :title="tr('Close')" @click="closeDetail" v-html="icon('x', 18)" />
						<div v-if="detailRef.type === 'text'" class="det-md">
							<div v-if="textEditorReady" ref="detailSlot" class="rb-texteditor" :class="{ editing: editingBody }" />
							<template v-else>
								<div v-if="!editingBody" class="mdview md" v-html="md(detailRef.body)" />
								<textarea v-else v-model="bodyDraft" class="det-text" />
							</template>
							<button class="mediabtn mdedit" :title="editingBody ? tr('Save') : tr('Edit')" @click="toggleBody" v-html="icon(editingBody ? 'check' : 'edit', 18)" />
						</div>
						<div v-else-if="detailRef.type === 'video'" class="det-mediabox">
							<div v-if="videoPlaying && embedSrc(detailRef)" class="det-video">
								<iframe class="det-videoframe" :src="embedSrc(detailRef)" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
							</div>
							<video v-else-if="videoPlaying && fileSrc(detailRef)" class="det-videoel" :src="fileSrc(detailRef)" controls autoplay></video>
							<div v-else class="det-img" :style="{ backgroundImage: thumbBg(detailRef) }">
								<img v-if="hasThumb(detailRef)" class="det-imgtag" :src="thumbUrl(detailRef)" @error="onImgError($event, detailRef)">
								<button v-if="!isIgVideo(detailRef)" class="playoverlay" :title="canPlayInline(detailRef) ? tr('Play') : tr('Open video')" @click="playVideo(detailRef)" v-html="play(30)" />
								<a v-if="!canPlayInline(detailRef)" class="playnote" :href="watchUrl(detailRef)" target="_blank" rel="noopener">{{ tr('Open the video externally') }}</a>
							</div>
						</div>
						<div v-else-if="detailRef.type === 'pdf'" class="det-pdf">
							<iframe v-if="pdfBlobUrl" :src="pdfBlobUrl" class="det-pdfframe" :title="tr('PDF preview')"></iframe>
							<div v-else class="det-pdfloading">{{ tr('Loading PDF...') }}</div>
						</div>
						<div v-else class="det-img" :style="{ backgroundImage: thumbBg(detailRef) }">
							<img v-if="hasThumb(detailRef)" class="det-imgtag" :src="thumbUrl(detailRef)" @error="onImgError($event, detailRef)">
						</div>
						<a v-if="detailRef.source_url && detailRef.type !== 'text' && detailRef.type !== 'video'" class="openlink-bar" :href="detailRef.source_url" target="_blank" rel="noopener"><span v-html="typeIcon(detailRef.type)" /> {{ tr('Open link') }}</a>
						<button v-if="detailRef.file_id != null && !videoPlaying" class="mediabtn locate" :title="tr('Show in Files')" @click="locateInFolder(detailRef)" v-html="icon('locate', 18)" />
					</div>
					<div class="detail-side">
						<div>
							<div class="dt-type"><span v-html="typeIcon(detailRef.type)" /> {{ typeName(detailRef.type) }}</div>
							<div class="dt-title">
								<template v-if="!editingTitle"><span class="dt-titletext">{{ detailRef.title }}</span><button v-if="boardMine(detailRef)" class="titleedit" :title="tr('Rename')" @click="startTitle" v-html="icon('edit', 14)" /></template>
								<template v-else><input v-model="titleDraft" class="titleinput" @keydown.enter="saveTitle" @keydown.esc="editingTitle = false"><button class="btn primary" style="padding:5px 9px" @click="saveTitle">{{ tr('Save') }}</button></template>
							</div>
							<div class="dt-owner"><span class="oav" :style="{ background: ownerColor(detailRef) }">{{ boardMine(detailRef) ? init(currentUser.displayName) : init(ownerName(detailRef)) }}</span>{{ boardMine(detailRef) ? tr('Your board') : ownerName(detailRef) }}</div>
						</div>

						<div v-if="detailRef.type !== 'text'" class="sec">
							<div class="sec-label">{{ tr('Description') }}</div>
							<textarea class="inlinefield" :value="detailRef.desc" :placeholder="tr('Add a description...')" @input="autoGrow" @blur="saveDescField" @keydown.enter.meta.prevent="blurField" @keydown.enter.ctrl.prevent="blurField" />
						</div>

						<div class="sec">
							<div class="sec-label">{{ tr('Link') }}</div>
							<div class="linkrow">
								<input class="linkfield" type="url" :value="detailRef.source_url" :placeholder="tr('Add a URL...')" @blur="saveLinkField" @keydown.enter.prevent="blurField">
								<a v-if="detailRef.source_url" class="linkopen btn" :href="detailRef.source_url" target="_blank" rel="noopener" :title="tr('Open link')" v-html="icon('link', 15)" />
							</div>
						</div>

						<div class="sec">
							<div class="sec-label">{{ tr('Tags') }}</div>
							<div class="taginput-wrap">
								<div class="taginput">
									<span v-for="t in detailRef.tags" :key="t.id" class="tgpill" :style="{ background: t.color, color: on(t.color) }">{{ t.name }} <span class="x" @click="removeDetailTag(t)">✕</span></span>
									<input v-model="detailTagInput" :placeholder="tr('Add a tag...')" @keydown.enter.prevent="commitDetailTag">
								</div>
								<div v-if="detailTagInput.trim() && detailTagSuggestions.length" class="tagsug">
									<div v-for="t in detailTagSuggestions" :key="t.id" class="tagsug-row" @mousedown.prevent="pickDetailTag(t)"><span class="tagsug-c" :style="{ background: t.color }" />{{ t.name }}</div>
								</div>
							</div>
						</div>

						<div v-if="geoApplicable(detailRef)" class="sec">
							<div class="sec-label">{{ tr('Location') }}<span v-if="geoSourceLabel(detailRef)" class="geo-src"> · {{ geoSourceLabel(detailRef) }}</span></div>
							<div v-if="detailRef.lat != null" class="geo-current">
								<a class="geo-open" :href="mapsUrl(detailRef)" target="_blank" rel="noopener"><span v-html="icon('pin', 14)" /> {{ geoLabel(detailRef) }}</a>
								<button class="geo-clear" :title="tr('Clear location')" @click="clearGeo" v-html="icon('x', 14)" />
							</div>
							<div class="geo-edit">
								<div class="geo-search">
									<input v-model="geoPlaceInput" :placeholder="geoBusy ? tr('Searching…') : tr('Search a place or address...')" @input="onGeoInput" @keydown.enter.prevent="geoEnter" @blur="onGeoBlur">
									<div v-if="geoSug.length" class="tagsug geo-sug">
										<div v-for="(s, i) in geoSug" :key="i" class="tagsug-row" @mousedown.prevent="pickGeoSug(s)"><span class="geo-sug-ic" v-html="icon('pin', 13)" /><span class="geo-sug-txt">{{ s.place }}</span></div>
									</div>
								</div>
							</div>
							<div v-if="geoMsg" class="hint" style="margin-top:4px">{{ geoMsg }}</div>
						</div>

						<div class="sec">
							<div class="sec-label">{{ tr('Note') }} <span style="font-weight:500;text-transform:none;letter-spacing:0">{{ tr('(visible to collaborators)') }}</span></div>
							<textarea class="inlinefield" :value="detailRef.note" :placeholder="tr('Add a note...')" @input="autoGrow" @blur="saveNoteField" @keydown.enter.meta.prevent="blurField" @keydown.enter.ctrl.prevent="blurField" />
						</div>

						<div class="sec">
							<div class="sec-label">{{ tr('Comments') }}</div>
							<div v-for="(c, i) in detailRef.comments" :key="c.id || i" class="comment">
								<span class="cav" :style="{ background: grad((c.actor || tr('You')).length * 5) }">{{ init(c.actor || tr('You')) }}</span>
								<div style="flex:1">
									<div class="cname">{{ c.actor }} <span v-if="c.actor === currentUser.uid" class="cactions"><button :title="tr('Delete')" @click="deleteComment(c)" v-html="icon('trash', 13)" /></span></div>
									<div class="ctext">{{ c.message }}</div>
								</div>
							</div>
							<div class="addcomment"><input v-model="commentText" :placeholder="tr('Write a comment...')" @keydown.enter="postComment"><button class="btn primary cbtn" @click="postComment">{{ tr('Post') }}</button></div>
						</div>

						<div class="sec"><button v-if="boardMine(detailRef)" class="btn danger" @click="deleteDetail" v-html="icon('trash', 14) + ' ' + tr('Delete reference')" /></div>
					</div>
				</div>
			</div>
		</div>

		<!-- Bulk add-tags modal -->
		<div v-if="bulkOpen" class="scrim show" @click.self="bulkOpen = false">
			<div class="modal show">
				<div class="mhead"><h2>{{ tr('Add tags') }}</h2><button class="close" @click="bulkOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody" style="padding-bottom:0">
					<div class="field" style="margin-bottom:8px"><input ref="bulkSearchField" v-model="bulkSearch" :placeholder="tr('Search or create tag')" @keydown.enter.prevent="bulkEnter"></div>
					<div class="mt-list">
						<div v-if="bulkSearch && !tagByName(bulkSearch)" class="mt-create" @click="bulkCreate">＋ {{ tr('Create "{name}"', { name: bulkSearch }) }}</div>
						<div v-for="t in bulkTagList" :key="t.id" class="mt-row" @click="bulkToggle(t)">
							<div class="mt-check" :class="bulkState(t)">{{ bulkState(t) === 'all' ? '✓' : bulkState(t) === 'some' ? '–' : '' }}</div>
							<span class="mt-name">{{ t.name }}</span><span class="mt-circle" :style="{ background: t.color }" />
						</div>
					</div>
					<div class="mt-info"><span v-html="icon('tag', 15)" /> {{ tr('Tag the {n} selected references', { n: selected.length }) }}</div>
				</div>
				<div class="mfoot"><button class="btn" @click="bulkOpen = false">{{ tr('Cancel') }}</button><button class="btn primary" @click="applyBulk">{{ tr('Apply') }}</button></div>
			</div>
		</div>

		<!-- Generic input prompt -->
		<div v-if="inputOpen" class="scrim show scrim-top" @click.self="inputOpen = false">
			<div class="modal show" style="width:min(420px,94vw)">
				<div class="mhead"><h2>{{ inputTitle }}</h2><button class="close" @click="inputOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody"><div class="field"><input ref="inputField" v-model="inputValue" :placeholder="inputPlaceholder" @keydown.enter="saveInput"></div></div>
				<div class="mfoot"><button class="btn" @click="inputOpen = false">{{ tr('Cancel') }}</button><button class="btn primary" @click="saveInput">{{ tr('Save') }}</button></div>
			</div>
		</div>

		<!-- Tag editor -->
		<div v-if="tagOpen" class="scrim show scrim-top" @click.self="tagOpen = false">
			<div class="modal show" style="width:min(440px,94vw)">
				<div class="mhead"><h2>{{ tagEditId ? tr('Edit tag') : tr('New tag') }}</h2><button class="close" @click="tagOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody">
					<div class="field"><label>{{ tr('Name') }}</label><input ref="tagNameField" v-model="tagName" :placeholder="tr('e.g. ceramics')" @keydown.enter="saveTag"></div>
					<div class="field"><label>{{ tr('Color') }}</label>
						<div v-for="g in paletteGroups" :key="g.name" class="swgroup">
							<div class="swlabel">{{ tr(g.name) }}</div>
							<div class="swatches"><span v-for="c in g.colors" :key="c" class="swatch" :class="{ sel: c === tagColor }" :style="{ background: c }" @click="tagColor = c" /></div>
						</div>
					</div>
					<div class="field"><label>{{ tr('Folder') }}</label><select v-model="tagFolder" class="rb-select"><option :value="null">{{ tr('Ungrouped') }}</option><option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option></select></div>
				</div>
				<div class="mfoot"><button class="btn" @click="tagOpen = false">{{ tr('Cancel') }}</button><button class="btn primary" @click="saveTag">{{ tr('Save tag') }}</button></div>
			</div>
		</div>

		<!-- Board editor -->
		<div v-if="boardOpen" class="scrim show scrim-top" @click.self="boardOpen = false">
			<div class="modal show" style="width:min(440px,94vw)">
				<div class="mhead"><h2>{{ boardEditId ? tr('Edit board') : tr('New board') }}</h2><button class="close" @click="boardOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody">
					<div class="field"><label>{{ tr('Name') }}</label><input ref="boardNameField" v-model="boardName" :placeholder="tr('Board name')" @keydown.enter="saveBoard"></div>
					<div class="field"><label>{{ tr('Folder location') }}</label><input v-model="boardLocation" placeholder="Curio/My Board" @keydown.enter="saveBoard"><div class="hint" style="margin-top:4px">{{ tr('This board\'s files live in this Nextcloud Files folder. Leave blank for a default folder. Changing it moves the whole folder.') }}</div></div>
					<div class="field"><label>{{ tr('Color') }}</label>
						<div v-for="g in paletteGroups" :key="g.name" class="swgroup">
							<div class="swlabel">{{ tr(g.name) }}</div>
							<div class="swatches"><span v-for="c in g.colors" :key="c" class="swatch" :class="{ sel: c === boardColor }" :style="{ background: c }" @click="boardColor = c" /></div>
						</div>
					</div>
				</div>
				<div class="mfoot"><button class="btn" @click="boardOpen = false">{{ tr('Cancel') }}</button><button class="btn primary" @click="saveBoard">{{ tr('Save board') }}</button></div>
			</div>
		</div>

		<!-- Share board -->
		<div v-if="shareOpen && shareBoardRef" class="scrim show scrim-top" @click.self="shareOpen = false">
			<div class="modal show" style="width:min(460px,94vw)">
				<div class="mhead"><h2>{{ tr('Share "{name}"', { name: shareBoardRef.name }) }}</h2><button class="close" @click="shareOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody">
					<div class="field"><label>{{ tr('Share with') }}</label><input ref="shareUserField" v-model="shareUser" :placeholder="tr('Nextcloud username')" @keydown.enter="doShare"></div>
					<div class="field">
						<label>{{ tr('Access') }}</label>
						<div class="setseg">
							<button :class="{ active: sharePerm === 'view' }" @click="sharePerm = 'view'">{{ tr('View only') }}</button>
							<button :class="{ active: sharePerm === 'edit' }" @click="sharePerm = 'edit'">{{ tr('Can edit') }}</button>
						</div>
						<div class="hint" style="margin-top:6px">{{ tr('This shares the board\'s Nextcloud folder. "Can edit" lets them add, change and remove references; "View only" is read and comment.') }}</div>
					</div>
					<div v-if="shareMsg" class="hint" style="color:#e0736a">{{ shareMsg }}</div>
					<div v-if="shareBoardRef.sharedWith && shareBoardRef.sharedWith.length" class="field">
						<label>{{ tr('Already shared with') }}</label>
						<div v-for="u in shareBoardRef.sharedWith" :key="u.uid" class="shareline">
							<span class="sl-name">{{ u.displayName || u.uid }}</span>
							<div class="setseg sl-seg">
								<button :class="{ active: u.level === 'view' }" @click="changeShareLevel(u, 'view')">{{ tr('View') }}</button>
								<button :class="{ active: u.level === 'edit' }" @click="changeShareLevel(u, 'edit')">{{ tr('Edit') }}</button>
							</div>
							<button class="sl-x" :title="tr('Remove')" @click="unshareBoard(shareBoardRef, u.uid)" v-html="icon('x', 15)" />
						</div>
					</div>
				</div>
				<div class="mfoot"><button class="btn" @click="shareOpen = false">{{ tr('Done') }}</button><button class="btn primary" :disabled="sharing || !shareUser.trim()" @click="doShare">{{ tr('Share') }}</button></div>
			</div>
		</div>

		<!-- Manage tags & folders -->
		<div v-if="manageTagsOpen" class="scrim show" @click.self="manageTagsOpen = false">
			<div class="modal show">
				<div class="mhead"><h2>{{ tr('Manage tags & folders') }}</h2><button class="close" @click="manageTagsOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody" style="max-height:60vh;overflow-y:auto">
					<template v-for="f in folders" :key="'mf' + f.id">
						<div class="mgfolder"><span>{{ f.name }}</span><div class="factions">
							<button @click="renameFolder(f)" v-html="icon('edit', 12) + ' ' + tr('Rename')" />
							<button class="danger" @click="deleteFolder(f)" v-html="icon('trash', 12) + ' ' + tr('Delete')" />
							<button @click="openTagModal(null, f.id)">＋ {{ tr('Tag') }}</button>
						</div></div>
						<div v-for="t in tagsInFolder(f.id)" :key="'mt' + t.id" class="tagchipline">
							<span class="c" :style="{ background: t.color }" /><span class="n">{{ t.name }}</span><span class="count">{{ tagRefCountAll(t.name) }}</span>
							<button :title="tr('Edit')" @click="openTagModal(t)" v-html="icon('edit', 14)" /><button :title="tr('Delete')" @click="deleteTag(t)" v-html="icon('trash', 14)" />
						</div>
					</template>
					<template v-if="ungroupedTags.length">
						<div class="mgfolder"><span>{{ tr('Ungrouped') }}</span><div class="factions"><button @click="openTagModal(null, null)">＋ {{ tr('Tag') }}</button></div></div>
						<div v-for="t in ungroupedTags" :key="'mu' + t.id" class="tagchipline">
							<span class="c" :style="{ background: t.color }" /><span class="n">{{ t.name }}</span><span class="count">{{ tagRefCountAll(t.name) }}</span>
							<button :title="tr('Edit')" @click="openTagModal(t)" v-html="icon('edit', 14)" /><button :title="tr('Delete')" @click="deleteTag(t)" v-html="icon('trash', 14)" />
						</div>
					</template>
					<div v-if="!folders.length && !ungroupedTags.length" class="noteempty" style="padding:8px 0">{{ tr('No tags or folders yet.') }}</div>
				</div>
				<div class="mfoot" style="justify-content:space-between"><button class="btn" @click="newFolder">＋ {{ tr('New folder') }}</button><button class="btn primary" @click="manageTagsOpen = false">{{ tr('Done') }}</button></div>
			</div>
		</div>

		<!-- Manage boards -->
		<div v-if="manageBoardsOpen" class="scrim show" @click.self="manageBoardsOpen = false">
			<div class="modal show">
				<div class="mhead"><h2>{{ tr('Manage boards') }}</h2><button class="close" @click="manageBoardsOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody" style="max-height:60vh;overflow-y:auto">
					<div v-for="b in sortedBoards" :key="'mb' + b.id" class="mgrow">
						<span v-if="b.mine" class="dot" :style="{ background: b.color }" /><span v-else class="owner-av" :style="{ background: b.color }">{{ init(b.ownerDisplayName) }}</span>
						<div style="flex:1;min-width:0">
							<div class="label">{{ b.name }}<span v-if="!b.mine" style="color:var(--text-soft);font-size:12px"> · {{ b.ownerDisplayName }}</span></div>
							<div v-if="b.mine && b.sharedWith.length" class="sharedwith">{{ tr('Shared with:') }} <span v-for="u in b.sharedWith" :key="u.uid" class="uchip">{{ u.displayName || u.uid }} · {{ u.level === 'edit' ? tr('can edit') : tr('view only') }} <span class="x" @click="unshareBoard(b, u.uid)">✕</span></span></div>
						</div>
						<div v-if="b.mine" class="acts">
							<button @click="openBoardModal(b)">{{ tr('Edit') }}</button>
							<button @click="shareBoardPrompt(b)">{{ tr('Share') }}</button>
							<button class="danger" @click="deleteBoard(b)">{{ tr('Delete') }}</button>
						</div>
						<div v-else class="acts"><button @click="soloBoard(b); manageBoardsOpen = false">{{ tr('View') }}</button></div>
					</div>
				</div>
				<div class="mfoot" style="justify-content:space-between"><button class="btn" @click="newBoard">＋ {{ tr('New board') }}</button><button class="btn primary" @click="manageBoardsOpen = false">{{ tr('Done') }}</button></div>
			</div>
		</div>

		<!-- Settings -->
		<div v-if="settingsOpen" class="scrim show" @click.self="settingsOpen = false">
			<div class="modal show" style="width:min(460px,94vw)">
				<div class="mhead"><h2>{{ tr('Settings') }}</h2><button class="close" @click="settingsOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody">
					<div class="field">
						<label>{{ tr('Appearance') }}</label>
						<div class="setseg">
							<button v-for="o in ['system', 'light', 'dark']" :key="o" :class="{ active: settings.theme === o }" @click="setTheme(o)">{{ tr(cap(o)) }}</button>
						</div>
					</div>
					<div class="field">
						<label>{{ tr('Default layout') }}</label>
						<div class="setseg">
							<button :class="{ active: settings.layout === 'square' }" @click="setLayout('square')">{{ tr('Grid') }}</button>
							<button :class="{ active: settings.layout === 'masonry' }" @click="setLayout('masonry')">{{ tr('Vertical') }}</button>
							<button :class="{ active: settings.layout === 'hmasonry' }" @click="setLayout('hmasonry')">{{ tr('Horizontal') }}</button>
							<button :class="{ active: settings.layout === 'map' }" @click="setLayout('map')">{{ tr('Map') }}</button>
						</div>
					</div>
					<div class="field">
						<label>{{ tr('Sort references by') }}</label>
						<div class="setseg">
							<button :class="{ active: (settings.sort || 'created_desc') === 'created_desc' }" @click="setSort('created_desc')">{{ tr('Newest') }}</button>
							<button :class="{ active: settings.sort === 'created_asc' }" @click="setSort('created_asc')">{{ tr('Oldest') }}</button>
							<button :class="{ active: settings.sort === 'title_asc' }" @click="setSort('title_asc')">{{ tr('A–Z') }}</button>
							<button :class="{ active: settings.sort === 'title_desc' }" @click="setSort('title_desc')">{{ tr('Z–A') }}</button>
						</div>
					</div>
					<div class="field">
						<label>{{ tr('Date format') }}</label>
						<div class="setseg">
							<button :class="{ active: (settings.dateFormat || 'auto') === 'auto' }" @click="setDateFormat('auto')">{{ tr('Auto') }}</button>
							<button :class="{ active: settings.dateFormat === 'dmy' }" @click="setDateFormat('dmy')">D/M/Y</button>
							<button :class="{ active: settings.dateFormat === 'mdy' }" @click="setDateFormat('mdy')">M/D/Y</button>
							<button :class="{ active: settings.dateFormat === 'ymd' }" @click="setDateFormat('ymd')">Y/M/D</button>
						</div>
						<div class="hint" style="margin-top:6px">{{ dateFormatSample }}</div>
					</div>
					<div class="field toggle-row">
						<label style="margin:0">{{ tr('Show titles & tags by default') }}</label>
						<button class="rbtoggle" :class="{ on: settings.labels }" :aria-pressed="settings.labels" @click="setLabels(!settings.labels)"><span /></button>
					</div>
					<div class="field">
						<label>{{ tr('Import / export (CSV)') }}</label>
						<select v-model="dataBoardId" class="rb-select" style="margin-bottom:8px"><option v-for="b in boards.filter(x => x.mine)" :key="b.id" :value="b.id">{{ b.name }}</option></select>
						<div style="display:flex;gap:8px">
							<button class="btn" :disabled="dataBusy" @click="exportCsv">{{ tr('Export CSV') }}</button>
							<label class="btn" style="cursor:pointer;display:inline-flex;align-items:center">{{ tr('Import CSV') }}<input type="file" accept=".csv,text/csv" style="display:none" @change="importCsv"></label>
						</div>
						<div class="hint" style="margin-top:6px">{{ dataMsg || tr('Export this board to a spreadsheet, or import rows and match them to files by title. Missing media shows a placeholder.') }}</div>
					</div>
				</div>
				<div class="mfoot"><button class="btn primary" @click="settingsOpen = false">{{ tr('Done') }}</button></div>
			</div>
		</div>

		<!-- Manual image crop -->
		<div v-if="cropOpen" class="scrim show scrim-top" @click.self="cropOpen = false">
			<div class="modal show cropmodal">
				<div class="mhead"><h2>{{ tr('Crop image') }}</h2><button class="close" @click="cropOpen = false" v-html="icon('x', 18)" /></div>
				<div class="mbody cropbody">
					<div class="cropstage">
						<img :src="cropSrc" class="cropimg" draggable="false" @load="onCropImgLoad" @dragstart.prevent>
						<div class="cropbox" :style="{ left: cropBox.x + 'px', top: cropBox.y + 'px', width: cropBox.w + 'px', height: cropBox.h + 'px' }" @mousedown.self.prevent="cropStart($event, 'move')">
							<span class="crophandle nw" @mousedown.stop.prevent="cropStart($event, 'nw')" />
							<span class="crophandle ne" @mousedown.stop.prevent="cropStart($event, 'ne')" />
							<span class="crophandle sw" @mousedown.stop.prevent="cropStart($event, 'sw')" />
							<span class="crophandle se" @mousedown.stop.prevent="cropStart($event, 'se')" />
						</div>
					</div>
					<div class="hint" style="margin-top:8px">{{ tr('Drag the box to move it, drag a corner to resize.') }}</div>
				</div>
				<div class="mfoot"><button class="btn" @click="cropOpen = false">{{ tr('Cancel') }}</button><button class="btn primary" :disabled="cropBusy" @click="applyCrop">{{ cropBusy ? tr('Cropping…') : tr('Apply crop') }}</button></div>
			</div>
		</div>

		<!-- Delete board confirmation -->
		<div v-if="deleteConfirm" class="scrim show scrim-top" @click.self="deleteConfirm = null">
			<div class="modal show" style="width:min(460px,94vw)">
				<div class="mhead"><h2>{{ tr('Delete board') }}</h2><button class="close" @click="deleteConfirm = null" v-html="icon('x', 18)" /></div>
				<div class="mbody">
					<p style="margin:0 0 10px">{{ tr('Delete the board "{name}"?', { name: deleteConfirm.name }) }}</p>
					<div class="del-danger"><span class="del-danger-ic" v-html="icon('trash', 16)" /><span>{{ tr('This board lives in your Nextcloud "Curio" folder. Deleting it permanently removes that folder and all of its contents (every reference file) from Nextcloud. This cannot be undone.') }}</span></div>
				</div>
				<div class="mfoot"><button class="btn" @click="deleteConfirm = null">{{ tr('Cancel') }}</button><button class="btn danger" :disabled="deletingBoard" @click="confirmDeleteBoard">{{ deletingBoard ? tr('Deleting…') : tr('Delete board and folder') }}</button></div>
			</div>
		</div>

		<div v-if="typeMenuOpen" class="menuscrim" @click="typeMenuOpen = false" />
		<div class="toasts">
			<div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.msg }}</div>
		</div>
	</div>
</template>

<script>
import { markRaw } from 'vue'
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { ic, playSvg, grad, svgThumb, initials, textOn, mdToHtml, parseVideo, videoWatchUrl, domainOf, TYPE_ICON, TYPE_NAME, PALETTE, PALETTE_GROUPS } from './helpers.js'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'

const api = (p) => generateUrl('/apps/curio/api' + p)
const rnd = () => PALETTE[Math.floor(Math.random() * PALETTE.length)]

export default {
	name: 'App',
	data() {
		return {
			loading: true,
			error: null,
			currentUser: { uid: '', displayName: '' },
			boards: [],
			references: [],
			tags: [],
			folders: [],
			settings: { theme: 'system', layout: 'square', labels: false, sort: 'created_desc', dateFormat: 'auto' },
			siActive: false, siHideTimer: null,
			shownTags: [],
			ungroupedOpen: true,
			search: '',
			navOpen: window.innerWidth > 820,
			isMobile: window.innerWidth <= 820,
			prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
			addTabs: [{ k: 'link', label: 'Link / URL' }, { k: 'upload', label: 'Upload' }, { k: 'text', label: 'Text' }],
			addOpen: false, addTab: 'link', addUrl: '', addTitle: '', addDesc: '', addBody: '', addTags: [], addTagInput: '', adding: false, addBoardId: null, flashId: null,
			addFetchType: null, addUploadType: 'image', uploadDragOver: false, addHashtags: [], addImages: [],
			addImg: null, addVideo: null, fetching: false, fetchMsg: '', uploading: false, addUploadMarker: null,
			detailOpen: false, detailRefId: null, detailFs: false, videoPlaying: false, pdfBlobUrl: null,
			editingBody: false, editingTitle: false, titleDraft: '',
			detailEditorInst: null, addEditorInst: null, textEditorReady: false,
			bodyDraft: '', commentText: '', detailTagInput: '',
			geoPlaceInput: '', geoBusy: false, geoMsg: '', addGeo: null,
			geoSug: [], addGeoQuery: '', addGeoSug: [], addGeoSuggestions: [], addGeoBusy: false,
			cropOpen: false, cropSrc: '', cropSrcRef: '', cropBusy: false, cropBox: { x: 0, y: 0, w: 0, h: 0 }, cropImgW: 0, cropImgH: 0,
			bulkOpen: false, bulkPending: {}, bulkSearch: '',
			palette: PALETTE, paletteGroups: PALETTE_GROUPS,
			inputOpen: false, inputTitle: '', inputValue: '', inputPlaceholder: '', inputCb: null,
			tagOpen: false, tagEditId: null, tagName: '', tagColor: PALETTE[1], tagFolder: null,
			boardOpen: false, boardEditId: null, boardName: '', boardColor: PALETTE[8], boardLocation: '',
			shareOpen: false, shareBoardRef: null, shareUser: '', sharePerm: 'edit', sharing: false, shareMsg: '',
			manageTagsOpen: false, manageBoardsOpen: false, settingsOpen: false, deleteConfirm: null, deletingBoard: false,
			dataBoardId: null, dataMsg: '', dataBusy: false,
			toasts: [], toastSeq: 0, addWarn: false, fetched: false, dragOver: false, dragTag: null,
			filterTypes: [], typeMenuOpen: false, currentIndexKey: '',
			imgAspect: {}, scrollable: false,
			needsSetup: false, folderConfigured: false, setupName: 'Curio', setupBusy: false, setupError: '',
			browseOpen: false, browsePath: '', browseParent: null, browseList: [], browseBusy: false,
		}
	},
	computed: {
		theme() { const t = this.settings.theme; return (t === 'dark' || (t === 'system' && this.prefersDark)) ? 'dark' : 'light' },
		dateLocale() {
			const df = this.settings.dateFormat || 'auto'
			if (df === 'dmy') return 'en-GB'
			if (df === 'mdy') return 'en-US'
			if (df === 'ymd') return 'sv-SE'
			const nc = (window.OC && typeof OC.getCanonicalLocale === 'function') ? OC.getCanonicalLocale() : ''
			return nc || navigator.language || 'en-US'
		},
		dateFormatSample() {
			try { return this.tr('Example: {date}', { date: new Date(2026, 6, 28).toLocaleDateString(this.dateLocale, { day: 'numeric', month: 'long', year: 'numeric' }) }) } catch (e) { return '' }
		},
		sortedBoards() { return [...this.boards].sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1)) },
		visibleRefs() { const vis = new Set(this.boards.filter(b => b.visible).map(b => b.id)); return this.references.filter(r => vis.has(r.board)) },
		filteredRefs() { return this.visibleRefs.filter(r => this.matchesFilter(r)) },
		sortedRefs() {
			const r = this.filteredRefs.slice()
			const s = this.settings.sort || 'created_desc'
			if (s === 'created_asc') r.sort((a, b) => (a.created || 0) - (b.created || 0))
			else if (s === 'title_asc') r.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
			else if (s === 'title_desc') r.sort((a, b) => (b.title || '').localeCompare(a.title || ''))
			else r.sort((a, b) => (b.created || 0) - (a.created || 0))
			return r
		},
		sortIsTitle() { const s = this.settings.sort || ''; return s === 'title_asc' || s === 'title_desc' },
		selected() { return this.references.filter(r => r._sel) },
		ungroupedTags() { const fids = new Set(this.folders.map(f => f.id)); return this.tags.filter(t => t.folder === null || !fids.has(t.folder)).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })) },
		gridClass() { return this.settings.layout === 'masonry' ? 'masonry' : this.settings.layout === 'hmasonry' ? 'hmasonry' : '' },
		viewTitle() { const vis = this.boards.filter(b => b.visible); if (!vis.length) return this.tr('Nothing shown'); if (vis.length === 1) return vis[0].name; return vis.map(b => b.name).join('  +  ') },
		detailRef() { return this.references.find(r => r.id === this.detailRefId) || null },
		titlePlaceholder() { return this.addTab === 'text' ? this.tr('Note title') : this.addTab === 'upload' ? this.tr('Image title') : this.tr('Title (optional)') },
		targetBoard() { const v = this.boards.filter(b => b.visible && b.mine); if (v.length) return v[0]; const m = this.boards.filter(b => b.mine); return m[0] || this.boards[0] },
		bulkTagList() { const q = this.bulkSearch.toLowerCase(); return this.tags.filter(t => t.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)) },
		emptyMessage() {
			if (!this.boards.some(b => b.visible)) return this.tr('Pick a board from the sidebar to see its references.')
			if (this.shownTags.length || this.search || this.filterTypes.length) return this.tr('Nothing matches your current filters.')
			return this.tr('This board is empty. Add a reference, or drop a file into its Nextcloud folder.')
		},
		presentTypes() {
			const counts = {}
			for (const r of this.visibleRefs) { const k = this.refKind(r); counts[k] = (counts[k] || 0) + 1 }
			const NAMES = { image: this.tr('Images'), link: this.tr('Web pages'), video: this.tr('Videos'), text: this.tr('Text notes'), pdf: this.tr('PDFs'), file: this.tr('Files') }
			return Object.keys(counts).sort().map(k => ({ type: k, name: NAMES[k] || k, count: counts[k] }))
		},
		addTagSuggestions() {
			const q = this.addTagInput.trim().toLowerCase(); if (!q) return []
			const have = new Set(this.addTags.map(t => t.id))
			return this.tags.filter(t => !have.has(t.id) && t.name.toLowerCase().includes(q)).slice(0, 6)
		},
		detailTagSuggestions() {
			const q = this.detailTagInput.trim().toLowerCase(); if (!q || !this.detailRef) return []
			const have = new Set(this.detailRef.tags.map(t => t.id))
			return this.tags.filter(t => !have.has(t.id) && t.name.toLowerCase().includes(q)).slice(0, 6)
		},
		// Visible references that carry a location - the map markers.
		locatedRefs() { return this.sortedRefs.filter(r => r.lat != null && r.lng != null && !isNaN(Number(r.lat)) && !isNaN(Number(r.lng))) },
		scrollIndex() {
			if (this.settings.layout === 'map') return []
			const refs = this.sortedRefs; if (!refs.length) return []
			const marks = []; const seen = new Set()
			for (const r of refs) { const k = this.indexKeyFor(r); if (k && !seen.has(k)) { seen.add(k); marks.push({ label: k, key: k, id: r.id }) } }
			return marks
		},
	},
	async mounted() {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { this.prefersDark = e.matches })
		window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 820; this.updateScrollable() })
		window.addEventListener('keydown', this.onKeydown)
		this.textEditorReady = this.checkTextEditor()
		await this.fetchState()
		this.$nextTick(() => { if (this.needsSetup) return; this.updateScrollable(); if (this.settings.layout === 'map') this.buildMap() })
	},
	watch: {
		// Recompute whether the grid overflows whenever the visible set or layout
		// changes, so the scroll index appears/disappears with the real content.
		sortedRefs() { this.$nextTick(() => this.updateScrollable()) },
		'settings.layout'(nv, ov) {
			this.$nextTick(() => this.updateScrollable());
			if (nv === 'map') { this.$nextTick(() => this.buildMap()); }
			else if (ov === 'map') { this.destroyMap(); }
		},
		// Refresh markers when the visible/located set changes while the map is shown.
		locatedRefs() { if (this._map) this.$nextTick(() => this.refreshMapMarkers()); },
		// Swap basemap tiles when the theme flips.
		theme() { if (this._map) this.swapMapTiles(); },
	},
	beforeUnmount() {
		window.removeEventListener('keydown', this.onKeydown)
		this.destroyMap()
		// Persistent editors are only torn down when the whole app unmounts (page
		// leave), so the Text teardown log never fires during normal note editing.
		for (const key of ['detailEditorInst', 'addEditorInst']) {
			const inst = this[key]
			if (inst) { try { inst.destroy() } catch (e) { /* page is unloading */ } this[key] = null }
		}
		this._detailHost = null; this._addHost = null
	},
	methods: {
		icon: ic, play: playSvg, grad, init: initials, on: textOn, md: mdToHtml,
		// Translate a UI string via Nextcloud's l10n (follows the user's NC language setting;
		// falls back to the English source when no catalogue is loaded, e.g. in dev). `vars`
		// substitutes {placeholders}. Named `tr` (not `t`) because the template already uses `t`
		// as a v-for loop variable in many places. `trn` is the plural form.
		tr(text, vars, count) {
			const w = typeof window !== 'undefined' ? window : null
			if (w && typeof w.t === 'function') { try { return w.t('curio', text, vars, count) } catch (e) { /* fall through */ } }
			let s = String(text)
			if (vars) { for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]) }
			return s
		},
		trn(text, textPlural, count, vars) {
			const w = typeof window !== 'undefined' ? window : null
			if (w && typeof w.n === 'function') { try { return w.n('curio', text, textPlural, count, vars) } catch (e) { /* fall through */ } }
			let s = String(count === 1 ? text : textPlural).replace(/%n/g, count)
			if (vars) { for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]) }
			return s
		},
		typeIcon(t) { return TYPE_ICON[t] || '' },
		typeName(t) { return TYPE_NAME[t] ? this.tr(TYPE_NAME[t]) : '' },
		watchUrl(r) { return videoWatchUrl(r) },
		embedSrc(r) {
			const v = r.video || {}
			if (v.provider === 'youtube') { const base = v.embed || ('https://www.youtube.com/embed/' + v.id); return base + (base.includes('?') ? '&' : '?') + 'autoplay=1&rel=0' }
			if (v.provider === 'vimeo') { const base = v.embed || ('https://player.vimeo.com/video/' + v.id); return base + (base.includes('?') ? '&' : '?') + 'autoplay=1' }
			// Instagram embed plays public reels/tv inline (private posts show IG's login prompt).
			if (v.provider === 'instagram') return v.embed || ('https://www.instagram.com/reel/' + v.id + '/embed')
			return null
		},
		fileSrc(r) { const v = r.video || {}; if (v.provider === 'file') { return r.file_id ? api('/references/' + r.id + '/file') : (v.src || r.source_url) } return null },
		canPlayInline(r) { return !!(this.embedSrc(r) || this.fileSrc(r)) },
		playVideo(r) { if (this.canPlayInline(r)) { this.videoPlaying = true } else { window.open(this.watchUrl(r), '_blank', 'noopener') } },
		// Instagram reels play inline via the embed; open its player straight away.
		autoPlayOnOpen(r) { return !!(r && r.type === 'video' && r.video && r.video.provider === 'instagram' && this.embedSrc(r)) },
		// Instagram reel covers already carry a baked-in play glyph, so we don't add ours
		// on top (avoids the two-stacked-play-buttons the owner saw).
		isIgVideo(r) { return !!(r && r.type === 'video' && r.video && r.video.provider === 'instagram') },
		// Open Nextcloud Files focused on this reference's backing file (the /f/{id} route).
		locateInFolder(r) { if (r.file_id == null) return; const u = (window.OC && OC.generateUrl) ? OC.generateUrl('/f/' + r.file_id) : ('/index.php/f/' + r.file_id); window.open(u, '_blank', 'noopener') },
		async fetchState() {
			this.loading = true
			try {
				const { data } = await axios.get(api('/state'))
				this.applyState(data)
			} catch (e) { this.error = 'Could not load your board.' } finally { this.loading = false }
		},
		// Apply a /state (or /base-folder) payload. When the base folder is not set
		// up yet the payload only carries the setup flag, so we show the setup screen
		// instead of the board.
		applyState(data) {
			if (data && data.needsFolderSetup) {
				this.needsSetup = true
				this.folderConfigured = !!data.folderConfigured
				this.currentUser = data.currentUser || this.currentUser
				this.settings = data.settings || this.settings
				if (data.suggestedFolder && !this.setupName) this.setupName = data.suggestedFolder
				this.error = null
				return
			}
			this.needsSetup = false
			this.browseOpen = false
			this.currentUser = data.currentUser
			this.boards = data.boards.map(b => ({ ...b }))
			this.references = data.references.map(r => ({ ...r, _sel: false }))
			// Seed aspect ratios from the stored image dimensions so the grid
			// reserves each card's size before any image loads (no reflow).
			for (const r of data.references) { if (r.w && r.h) this.imgAspect[r.id] = r.w / r.h }
			this.tags = data.tags
			this.folders = data.folders.map(f => ({ ...f }))
			this.settings = data.settings
			this.error = null
		},
		async submitCreateFolder() {
			const name = (this.setupName || '').trim()
			if (!name) return
			this.setupBusy = true; this.setupError = ''
			try { const { data } = await axios.post(api('/base-folder'), { mode: 'create', name }); this.applyState(data); this.$nextTick(() => this.updateScrollable()) }
			catch (e) { this.setupError = (e.response && e.response.data && e.response.data.error) || this.tr('Could not create the folder.') }
			finally { this.setupBusy = false }
		},
		async openBrowse() { this.browseOpen = true; this.setupError = ''; await this.browseTo('') },
		async browseTo(path) {
			this.browseBusy = true; this.setupError = ''
			try {
				const { data } = await axios.get(api('/folders/browse'), { params: { path: path || '' } })
				this.browsePath = data.path || ''
				this.browseParent = data.parent
				this.browseList = data.folders || []
			} catch (e) { this.setupError = this.tr('Could not open that folder.') }
			finally { this.browseBusy = false }
		},
		async chooseCurrentFolder() {
			if (!this.browsePath) return
			this.setupBusy = true; this.setupError = ''
			try { const { data } = await axios.post(api('/base-folder'), { mode: 'existing', path: this.browsePath }); this.applyState(data); this.$nextTick(() => this.updateScrollable()) }
			catch (e) { this.setupError = (e.response && e.response.data && e.response.data.error) || this.tr('Could not use that folder.') }
			finally { this.setupBusy = false }
		},
		matchesFilter(r) {
			if (this.shownTags.length && !r.tags.some(t => this.shownTags.includes(t.name))) return false
			if (this.filterTypes.length && !this.filterTypes.includes(this.refKind(r))) return false
			if (this.search) { const hay = (r.title + ' ' + (r.desc || '') + ' ' + (r.body || '') + ' ' + r.tags.map(t => t.name).join(' ') + ' ' + (r.source_url || '')).toLowerCase(); if (!hay.includes(this.search.toLowerCase())) return false }
			return true
		},
		refKind(r) { return r.type === 'image_url' ? 'image' : r.type },
		toggleType(t) { const i = this.filterTypes.indexOf(t); if (i >= 0) this.filterTypes.splice(i, 1); else this.filterTypes.push(t) },
		indexKeyFor(r) {
			if (this.sortIsTitle) { const t = (r.title || '').trim(); return t ? t[0].toUpperCase() : '#' }
			const d = new Date((r.created || 0) * 1000); const y = d.getFullYear()
			if (!Number.isFinite(y) || y <= 1971) return ''
			return d.toLocaleDateString(this.dateLocale, { month: 'short', year: 'numeric' })
		},
		jumpToIndex(m) {
			// Scroll the grid container itself (never ancestors) to the position of
			// this mark's reference, mapped the same way onGridScroll reads it back:
			// index -> ratio -> scrollTop. This stays monotonic in every layout, so
			// clicking dots top-to-bottom always moves the page down in order.
			const el = this.$refs.mainScroll
			if (!el) return
			const refs = this.sortedRefs
			const idx = refs.findIndex(r => r.id === m.id)
			if (idx < 0) return
			const max = el.scrollHeight - el.clientHeight
			if (max <= 0) return
			const ratio = refs.length > 1 ? idx / (refs.length - 1) : 0
			el.scrollTo({ top: Math.round(ratio * max), behavior: 'smooth' })
			this.currentIndexKey = m.key
			this.siActive = true
			if (this.siHideTimer) clearTimeout(this.siHideTimer)
			this.siHideTimer = setTimeout(() => { this.siActive = false }, this.isMobile ? 2500 : 1100)
		},
		pickAddTag(t) { if (!this.addTags.some(x => x.id === t.id)) this.addTags.push(t); this.addTagInput = '' },
		normTag(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '') },
		fuzzyTagMatch(h) { const n = this.normTag(h); if (!n) return null; return this.tags.find(t => this.normTag(t.name) === n) || null },
		// Split a hashtag into its constituent words on explicit boundaries:
		// underscores, hyphens, camelCase transitions, and letter/digit boundaries.
		splitHashtag(h) {
			return String(h || '')
				.replace(/[_\-]+/g, ' ')
				.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
				.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
				.replace(/([a-zA-Z])([0-9])/g, '$1 $2')
				.replace(/([0-9])([a-zA-Z])/g, '$1 $2')
				.split(/\s+/).map(w => w.trim()).filter(Boolean)
		},
		// Break a run-together hashtag (e.g. the all-lowercase Instagram style
		// "#streetphotography") into a sequence of EXISTING tags, using the user's
		// own tags as the vocabulary. Full cover only, >=2 segments, each >=3 chars,
		// so it never invents a tag - it only recognises ones that already exist.
		segmentByTags(norm) {
			if (!norm) return []
			const entries = this.tags.map(t => ({ t, n: this.normTag(t.name) })).filter(e => e.n.length >= 3)
			const n = norm.length; const memo = {}
			const solve = (i) => {
				if (i === n) return []
				if (i in memo) return memo[i]
				for (const e of entries) { if (norm.startsWith(e.n, i)) { const rest = solve(i + e.n.length); if (rest) return (memo[i] = [e.t, ...rest]) } }
				return (memo[i] = null)
			}
			const r = solve(0)
			return (r && r.length >= 2) ? r : []
		},
		// All existing tags a hashtag maps to: the whole hashtag, its explicit words,
		// and (for run-together hashtags) a segmentation into existing tags.
		matchHashtagTags(h) {
			const out = new Map()
			const whole = this.fuzzyTagMatch(h); if (whole) out.set(whole.id, whole)
			const words = this.splitHashtag(h); let wordHit = false
			if (words.length > 1) { for (const w of words) { const m = this.fuzzyTagMatch(w); if (m) { out.set(m.id, m); wordHit = true } } }
			if (!whole && !wordHit) { for (const t of this.segmentByTags(this.normTag(h))) out.set(t.id, t) }
			return Array.from(out.values())
		},
		// Existing tags (including multi-word ones) that appear as whole words/phrases
		// in a block of text. Used to auto-tag from the fetched title + description.
		autoTagMatches(text) {
			const hay = String(text || ''); if (!hay.trim()) return []
			const out = []
			for (const t of this.tags) {
				const name = (t.name || '').trim(); if (name.length < 2) continue
				const esc = name.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
				let re
				try { re = new RegExp('(?<![\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'iu') } catch (e) { re = new RegExp('\\b' + esc + '\\b', 'i') }
				if (re.test(hay)) out.push(t)
			}
			return out
		},
		stripHashtags(text) { return (text || '').replace(/#[\p{L}0-9_]{1,50}/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim() },
		extractHashtags(text) { const tags = []; const re = /#([\p{L}0-9_]{1,50})/gu; let m; while ((m = re.exec(text || '')) !== null) { tags.push(m[1]) } return { text: this.stripHashtags(text), tags: [...new Set(tags)] } },
		async addHashtag(h) { const t = await this.resolveTag(h); if (!this.addTags.some(x => x.id === t.id)) this.addTags.push(t); this.addHashtags = this.addHashtags.filter(x => x !== h) },
		async pickDetailTag(t) { const ids = this.detailRef.tags.map(x => x.id); if (!ids.includes(t.id)) ids.push(t.id); await this.patch({ tagIds: ids }); this.detailTagInput = '' },
		boardById(id) { return this.boards.find(b => b.id === id) },
		boardMine(r) { const b = this.boardById(r.board); return b ? b.mine : true },
		ownerColor(r) { const b = this.boardById(r.board); return b ? b.color : '#888' },
		ownerName(r) { const b = this.boardById(r.board); return b ? b.ownerDisplayName : '' },
		refCountForBoard(id) { return this.references.filter(r => r.board === id).length },
		tagsInFolder(fid) { return this.tags.filter(t => t.folder === fid).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })) },
		tagRefCount(name) { return this.visibleRefs.filter(r => r.tags.some(t => t.name === name)).length },
		tagByName(name) { return this.tags.find(t => t.name.toLowerCase() === name.toLowerCase()) },
		isText(r) { return r.type === 'text' },
		isSolo(b) { return b.visible && this.boards.filter(x => x.visible).length === 1 },
		sourceLabel(r) { return domainOf(r.source_url) },
		hasThumb(r) { return !!(r.img && !r._imgfail) },
		thumbUrl(r) { return this.hasThumb(r) ? api('/references/' + r.id + '/thumbnail') : '' },
		thumbBg(r) { return this.hasThumb(r) ? `url(${this.thumbUrl(r)})` : svgThumb(r.seed) },
		soloBoard(b) { this.boards.forEach(x => { x.visible = (x === b) }); if (this.isMobile) this.navOpen = false },
		toggleTag(name) { const i = this.shownTags.indexOf(name); if (i >= 0) this.shownTags.splice(i, 1); else this.shownTags.push(name) },
		folderShown(tags) { return tags.length > 0 && tags.every(t => this.shownTags.includes(t.name)) },
		toggleFolder(tags) {
			const names = tags.map(t => t.name)
			if (this.folderShown(tags)) { this.shownTags = this.shownTags.filter(n => !names.includes(n)) } else { const set = new Set(this.shownTags); names.forEach(n => set.add(n)); this.shownTags = Array.from(set) }
		},
		cardClass(r) { return { text: this.isText(r), selected: r._sel, shared: !this.boardMine(r), flash: this.flashId === r.id } },
		masonryHeight(r) { const s = r.seed || 1; return this.isText(r) ? (170 + (s * 11 % 90)) : (150 + (s * 17 % 180)) },
		thumbStyle(r) {
			const bg = this.hasThumb(r) ? `url(${this.thumbUrl(r)})` : svgThumb(r.seed)
			const s = { backgroundImage: bg }
			// Vertical masonry reserves each card's size BEFORE the image loads: use the
			// stored intrinsic dimensions as an aspect-ratio box (so the grid lays out
			// once and images fill in), falling back to a seed height when no dimensions
			// are known yet (remote posters, pdf, video).
			if (this.settings.layout === 'masonry') {
				if (r.w && r.h) s.aspectRatio = r.w + ' / ' + r.h
				else s.height = this.masonryHeight(r) + 'px'
			}
			return s
		},
		cardStyle(r) {
			if (this.settings.layout === 'masonry') return {}
			if (this.settings.layout === 'hmasonry') {
				const H = this.isMobile ? 118 : 188; const s = { height: H + 'px' }
				if (this.isText(r)) { if (this.isMobile) { s.flexGrow = '999'; s.flexBasis = '100%' } else { s.flexGrow = '1.4'; s.flexBasis = '300px' } } else {
					// Use the real image aspect ratio once loaded so rows respect the
					// actual image width; fall back to a seed estimate until then.
					const ar = this.imgAspect[r.id] || (0.7 + (r.seed * 13 % 12) / 10)
					s.flexGrow = ar.toFixed(3); s.flexBasis = Math.round(ar * H) + 'px'
				}
				return s
			}
			return {}
		},
		onImgError(e, r) { if (r) r._imgfail = true },
		onImgLoad(e, r) {
			const w = e.target.naturalWidth, h = e.target.naturalHeight
			if (r && w && h) this.imgAspect[r.id] = w / h
			this.updateScrollable()
		},
		toast(msg, type = 'info') { const id = ++this.toastSeq; this.toasts.push({ id, msg, type }); setTimeout(() => { const i = this.toasts.findIndex(t => t.id === id); if (i >= 0) this.toasts.splice(i, 1) }, 3500) },
		toggleFolderExpand(f) { f.expanded = !f.expanded; axios.put(api('/folders/' + f.id), { expanded: f.expanded }).catch(() => {}) },
		onDragLeave(e) { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) this.dragOver = false },
		// Main drop overlay is suppressed while dragging a tag onto a card (B7).
		onMainDragOver() { if (!this.dragTag) this.dragOver = true },
		async onDrop(e) {
			if (this.dragTag) { this.dragOver = false; return }
			this.dragOver = false
			const dt = e.dataTransfer; if (!dt) return
			if (dt.files && dt.files.length) { const f = dt.files[0]; if (f.type.startsWith('image/') || f.type === 'application/pdf') { this.openAdd(); this.setTab('upload'); await this.onUploadFile(f); return } }
			const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim()
			if (/^https?:\/\//i.test(raw)) {
				this.openAdd()
				this.setTab('link'); this.addUrl = raw; this.$nextTick(() => this.doFetch())
			}
		},
		addAnyway() { this.addWarn = false; this.fetched = true; this.doAdd() },
		fetchNow() { this.addWarn = false; this.doFetch() },

		/* ---- drag a tag onto a card to apply it (B7) ---- */
		onTagDragStart(e, t) {
			this.dragTag = t
			try {
				e.dataTransfer.effectAllowed = 'copy'
				e.dataTransfer.setData('text/plain', t.name)
				// A phantom tag pill follows the cursor (the only visual during the drag).
				const pill = document.createElement('div')
				pill.textContent = t.name
				pill.style.cssText = `position:fixed;top:-1000px;left:-1000px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;white-space:nowrap;color:${this.on(t.color)};background:${t.color};box-shadow:0 2px 8px rgba(0,0,0,.3)`
				document.body.appendChild(pill)
				this._dragPill = pill
				e.dataTransfer.setDragImage(pill, 12, 14)
			} catch (err) { /* dnd unsupported */ }
		},
		onTagDragEnd() { this.dragTag = null; if (this._dragPill) { this._dragPill.remove(); this._dragPill = null } },
		onCardDragOver(e) { if (this.dragTag) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' } },
		onCardDrop(e, r) {
			if (!this.dragTag) return
			e.preventDefault(); e.stopPropagation()
			const tag = this.dragTag
			// Dropped on a selected card -> apply to the whole selection; otherwise just this card.
			const targets = (r._sel && this.selected.length) ? this.selected.slice() : [r]
			this.applyTagToRefs(tag, targets)
		},
		async applyTagToRefs(tag, targets) {
			const refIds = targets.map(r => r.id)
			if (!refIds.length) return
			try {
				await axios.post(api('/references/bulk-tag'), { refIds, addTagIds: [tag.id], removeTagIds: [] })
				for (const r of targets) { if (!r.tags.some(x => x.id === tag.id)) r.tags.push({ id: tag.id, name: tag.name, color: tag.color }) }
				this.toast(targets.length > 1 ? this.tr('Tagged {n} references "{name}"', { n: targets.length, name: tag.name }) : this.tr('Tagged "{name}"', { name: tag.name }), 'success')
			} catch (e) { this.toast(this.tr('Could not apply the tag.'), 'error') }
		},
		toggleSelect(r) { r._sel = !r._sel },
		clearSelection() { this.references.forEach(r => { r._sel = false }) },
		setLayout(l) { this.settings.layout = l; this.persistSettings() },
		toggleLabels() { this.settings.labels = !this.settings.labels; this.persistSettings() },
		openSettings() { if (!this.dataBoardId) { const m = this.boards.find(b => b.mine); this.dataBoardId = m ? m.id : null } this.dataMsg = ''; this.settingsOpen = true },
		async exportCsv() {
			const id = this.dataBoardId || (this.boards.find(b => b.mine) || {}).id
			if (!id) return
			this.dataBusy = true
			try {
				const { data } = await axios.get(api('/boards/' + id + '/export'), { responseType: 'blob' })
				const b = this.boards.find(x => x.id === id)
				const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = ((b && b.name) || 'board') + '.csv'; a.click(); URL.revokeObjectURL(url)
				this.dataMsg = this.tr('Exported.')
			} catch (e) { this.dataMsg = this.tr('Export failed.') } finally { this.dataBusy = false }
		},
		async importCsv(e) {
			const file = e.target.files && e.target.files[0]; if (!file) return
			const id = this.dataBoardId || (this.boards.find(b => b.mine) || {}).id
			if (!id) { e.target.value = ''; return }
			this.dataBusy = true; this.dataMsg = this.tr('Importing...')
			try {
				const text = await file.text()
				const { data } = await axios.post(api('/boards/' + id + '/import'), { csv: text })
				this.dataMsg = this.tr('Imported {total}: {created} created, {matched} matched, {missing} missing media.', { total: data.imported, created: data.created, matched: data.matched, missing: data.missing })
				await this.fetchState()
			} catch (err) { this.dataMsg = this.tr('Import failed.') } finally { this.dataBusy = false; e.target.value = '' }
		},
		setTheme(t) { this.settings.theme = t; this.persistSettings() },
		setLabels(v) { this.settings.labels = v; this.persistSettings() },
		cap(s) { return (s || '').charAt(0).toUpperCase() + (s || '').slice(1) },
		async persistSettings() { try { await axios.put(api('/settings'), { theme: this.settings.theme, layout: this.settings.layout, labels: this.settings.labels, sort: this.settings.sort, dateFormat: this.settings.dateFormat }) } catch (e) { /* non-fatal */ } },
		setSort(v) { this.settings.sort = v; this.persistSettings() },
		setDateFormat(v) { this.settings.dateFormat = v; this.persistSettings() },
		onGridScroll(e) {
			const el = e.target
			const refs = this.sortedRefs
			if (!refs.length) { this.scrollable = false; return }
			const max = el.scrollHeight - el.clientHeight
			this.scrollable = max >= 40
			if (!this.scrollable) return
			const ratio = Math.min(1, Math.max(0, el.scrollTop / max))
			const idx = Math.min(refs.length - 1, Math.round(ratio * (refs.length - 1)))
			this.currentIndexKey = this.indexKeyFor(refs[idx])
			this.siActive = true
			if (this.siHideTimer) clearTimeout(this.siHideTimer)
			this.siHideTimer = setTimeout(() => { this.siActive = false }, this.isMobile ? 2500 : 1100)
		},
		// Whether the grid actually overflows enough to scroll. The scroll index is
		// only shown when true, so on a short page there is no dot to mis-click.
		updateScrollable() {
			const el = this.$refs.mainScroll
			this.scrollable = !!el && (el.scrollHeight - el.clientHeight) >= 40
		},

		/* tag resolve/create */
		async resolveTag(name) {
			const ex = this.tagByName(name)
			if (ex) return ex
			const folder = this.folders.length ? this.folders[0].id : null
			const { data } = await axios.post(api('/tags'), { name, color: rnd(), folder })
			this.tags.push(data)
			return data
		},

		/* ---- Nextcloud Text editor (single persistent instance per surface) ----
		   The editor is built once and kept alive; its DOM host is relocated into
		   the open modal and its content swapped with setContent/setReadOnly, rather
		   than being destroyed on every close. This avoids Text's benign-but-noisy
		   tiptap teardown log firing during normal note editing. */
		checkTextEditor() { return !!(window.OCA && window.OCA.Text && typeof window.OCA.Text.createEditor === 'function') },
		editorHost(key) { if (!this[key]) { const d = document.createElement('div'); d.style.width = '100%'; this[key] = d } return this[key] },
		detach(host) { if (host && host.parentNode) host.parentNode.removeChild(host) },
		// Attach the persistent host into `slot`, building the editor on first use.
		async openEditor(slot, hostKey, instKey, content, readOnly, onMd) {
			if (!slot || !this.textEditorReady) return
			const host = this.editorHost(hostKey)
			if (host.parentNode !== slot) { this.detach(host); slot.appendChild(host) }
			if (!this[instKey]) {
				this[instKey] = markRaw(await window.OCA.Text.createEditor({
					el: host, content: content || '', readOnly, autofocus: false,
					onUpdate: ({ markdown }) => { onMd(markdown) },
				}))
			} else {
				this[instKey].setContent(content || '')
				this[instKey].setReadOnly(readOnly)
			}
		},

		/* add flow */
		openAdd() { this.detach(this._addHost); this.textEditorReady = this.checkTextEditor(); this.addTab = 'link'; this.addUrl = ''; this.addTitle = ''; this.addDesc = ''; this.addBody = ''; this.addTags = []; this.addTagInput = ''; this.addImg = null; this.addVideo = null; this.addFetchType = null; this.addUploadType = 'image'; this.fetching = false; this.fetchMsg = ''; this.uploading = false; this.addUploadMarker = null; this.addWarn = false; this.fetched = false; this.addHashtags = []; this.addImages = []; this.addGeo = null; this.addGeoQuery = ''; this.addGeoSug = []; this.addGeoSuggestions = []; this.addGeoBusy = false; this._rawTitle = ''; this._rawDesc = ''; this.addBoardId = this.targetBoard ? this.targetBoard.id : null; this.addOpen = true; this.focusRef('addUrlField') },
		// Choosing an image from a gallery/social post imports THAT image as the photo.
		pickImage(u) { this.addImg = u; if (this.addFetchType === 'link' || !this.addFetchType) this.addFetchType = 'image_url' },
		dropImage(u) { this.addImages = this.addImages.filter(x => x !== u); if (this.addImg === u) this.addImg = this.addImages[0] || null },
		closeAdd() { this.detach(this._addHost); this.addOpen = false },
		setTab(k) {
			const prev = this.addTab
			this.addTab = k
			this.fetchMsg = ''
			this.addWarn = false; this.fetched = false; this.addHashtags = []
			if (prev !== k) { this.addImg = null; this.addVideo = null; this.addUploadMarker = null }
			if (prev === 'text' && k !== 'text') this.detach(this._addHost)
			if (k === 'text' && this.textEditorReady) {
				this.$nextTick(() => { this.openEditor(this.$refs.addSlot, '_addHost', 'addEditorInst', this.addBody, false, md => { this.addBody = md }) })
			}
		},
		async doFetch() {
			const url = (this.addUrl || '').trim()
			if (!url || this.fetching) return
			this.fetching = true; this.fetchMsg = ''
			try {
				const { data } = await axios.post(api('/fetch'), { url })
				this.addFetchType = data.type || null
				if (data.image) this.addImg = data.image
				this.addImages = Array.isArray(data.images) ? data.images.slice() : (data.image ? [data.image] : [])
				this.addGeo = data.geo || null
				// Raw (pre-cleanup) caption for location detection, so place names that live
				// in an engagement prefix / a stripped sentence / truncated text are still seen.
				this._rawTitle = data.raw_title || ''; this._rawDesc = data.raw_desc || ''
				this.addGeoSuggestions = []; this.addGeoSug = []; this.addGeoQuery = ''; this.addGeoBusy = false; this._geoSeq = (this._geoSeq || 0) + 1
				if (data.video) this.addVideo = data.video
				const ht = this.extractHashtags(data.description || '')
				if (data.title && !this.addTitle) this.addTitle = this.stripHashtags(data.title)
				if (data.description) this.addDesc = ht.text
				// Hashtags that match existing tags are added automatically. A hashtag
				// can map to several tags via its separate words (e.g. #streetPhotography
				// -> street + photography); anything unmatched is offered as a suggestion.
				const remaining = []
				for (const h of ht.tags) {
					const matches = this.matchHashtagTags(h)
					if (matches.length) { for (const m of matches) { if (!this.addTags.some(x => x.id === m.id)) this.addTags.push(m) } } else remaining.push(h)
				}
				this.addHashtags = remaining
				// During the fetch ONLY, scan the title + description for existing tags
				// (including multi-word ones) and add them. Not re-run afterwards, so
				// tags the user removes won't be re-added.
				for (const t of this.autoTagMatches((this.addTitle || '') + ' \n ' + (this.addDesc || ''))) {
					if (!this.addTags.some(x => x.id === t.id)) this.addTags.push(t)
				}
				if (!data.image && !data.title && !data.description && !data.video) this.fetchMsg = this.tr('No preview details found. You can still add it.')
				// No embedded page geo: offer a suggestion inferred from the title/desc.
				if (!this.addGeo) this.inferAddGeo()
			} catch (e) { this.fetchMsg = this.tr('Could not fetch this URL. You can still add it.') } finally { this.fetching = false; this.fetched = true }
		},
		async onUploadPick(e) { const file = e.target.files && e.target.files[0]; await this.onUploadFile(file); if (e.target) e.target.value = '' },
		async onUploadDrop(e) { this.uploadDragOver = false; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) await this.onUploadFile(f) },
		async onUploadFile(file) {
			if (!file) return
			this.fetchMsg = ''
			this.addUploadType = (file.type === 'application/pdf') ? 'pdf' : 'image'
			this.addImg = this.addUploadType === 'image' ? URL.createObjectURL(file) : null
			if (!this.addTitle) this.addTitle = file.name.replace(/\.[^.]+$/, '')
			this.uploading = true; this.addUploadMarker = null
			try {
				const fd = new FormData()
				fd.append('file', file)
				const { data } = await axios.post(api('/upload'), fd)
				this.addUploadMarker = data.img
			} catch (err) { this.fetchMsg = this.tr('Upload failed. Please try a different image.'); this.addImg = null; this.toast(this.tr('Upload failed.'), 'error') } finally { this.uploading = false }
		},
		async commitAddTag() { const n = this.addTagInput.trim(); if (!n) return; const t = await this.resolveTag(n); if (!this.addTags.some(x => x.id === t.id)) this.addTags.push(t); this.addTagInput = '' },
		async doAdd() {
			if (this.adding) return
			if (!this.addWarn && this.addTab === 'link' && (this.addUrl || '').trim() && !this.fetched) { this.addWarn = true; return }
			this.adding = true
			try {
				const board = this.boards.find(b => b.id === this.addBoardId && b.mine) || this.targetBoard
				const tagIds = this.addTags.map(t => t.id)
				const seed = Math.floor(Math.random() * 9999)
				let payload
				if (this.addTab === 'text') payload = { type: 'text', title: this.addTitle || 'Untitled note', body: this.addBody, tagIds, seed }
				else if (this.addTab === 'upload') payload = { type: this.addUploadType || 'image', title: this.addTitle || 'Untitled upload', img: this.addUploadMarker || null, desc: this.addDesc, tagIds, seed }
				else {
					const url = (this.addUrl || '').trim()
					const type = this.addFetchType || this.detectUrlType(url)
					if (type === 'video') { const v = this.addVideo || parseVideo(url); payload = { type: 'video', title: this.addTitle || 'Video', source_url: url, video: v, img: this.addImg || (v && v.thumb ? v.thumb : null), desc: this.addDesc, tagIds, seed } }
					else if (type === 'image_url') payload = { type: 'image_url', title: this.addTitle || (url.split('/').pop() || 'image'), source_url: url, img: this.addUploadMarker || this.addImg || url, desc: this.addDesc, tagIds, seed }
					else if (type === 'pdf') payload = { type: 'pdf', title: this.addTitle || (decodeURIComponent(url.split('/').pop() || 'document').replace(/\.pdf$/i, '')), source_url: url, desc: this.addDesc, tagIds, seed }
					else payload = { type: 'link', title: this.addTitle || url || 'New reference', source_url: url, img: this.addImg || null, desc: this.addDesc, tagIds, seed }
				}
				payload.board = board.id
				if (this.addGeo && this.addGeo.lat != null && this.addGeo.lng != null) {
					payload.geo = { lat: this.addGeo.lat, lng: this.addGeo.lng, place: this.addGeo.place || null, source: this.addGeo.source || 'page' }
				}
				const { data } = await axios.post(api('/references'), payload)
				board.visible = true
				const created = { ...data, _sel: false }
				this.references.unshift(created)
				this.closeAdd()
				this.revealReference(created)
			} catch (e) { this.toast((e.response && e.response.data && e.response.data.error) || this.tr('Could not add the reference.'), 'error') } finally { this.adding = false }
		},
		// Bring a reference into view after it is created: make its board visible,
		// drop any active filter that would hide it, then scroll to its position
		// (which depends on the current sort) and flash it briefly.
		revealReference(r) {
			const b = this.boardById(r.board); if (b) b.visible = true
			if (this.filterTypes.length && !this.filterTypes.includes(this.refKind(r))) this.filterTypes = []
			const names = (r.tags || []).map(t => t.name)
			if (this.shownTags.length && !names.some(n => this.shownTags.includes(n))) this.shownTags = []
			if (this.search && !this.matchesFilter(r)) this.search = ''
			// The card may not be in the DOM yet (board just made visible, filters just
			// cleared, list re-sorting): poll briefly until it exists, then scroll+flash.
			let tries = 0
			const tryScroll = () => {
				const el = this.$refs.mainScroll && this.$refs.mainScroll.querySelector('[data-rid="' + r.id + '"]')
				if (el) {
					el.scrollIntoView({ block: 'center', behavior: 'smooth' })
					this.flashId = r.id
					if (this._flashTimer) clearTimeout(this._flashTimer)
					this._flashTimer = setTimeout(() => { this.flashId = null }, 1600)
					return
				}
				if (tries++ < 24) setTimeout(tryScroll, 50)
			}
			this.$nextTick(tryScroll)
		},
		detectUrlType(u) {
			if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(u)) return 'image_url'
			if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(u) || /\.(mp4|webm|ogg)(\?|#|$)/i.test(u)) return 'video'
			if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf'
			return 'link'
		},

		/* detail flow */
		openDetail(r) {
			this.detach(this._detailHost)
			this.textEditorReady = this.checkTextEditor()
			this.detailRefId = r.id; this.detailFs = false; this.videoPlaying = this.autoPlayOnOpen(r); this.editingBody = this.editingTitle = false; this.commentText = ''; this.detailTagInput = ''
			this.geoPlaceInput = ''; this.geoMsg = ''; this.geoSug = []
			this.growInlineFields()
			this.bodyDraft = r.body || ''
			this.revokePdf()
			if (r.type === 'pdf') this.loadPdfBlob(r)
			this.detailOpen = true
			if (r.type === 'text' && this.textEditorReady) {
				this.$nextTick(() => { this.openEditor(this.$refs.detailSlot, '_detailHost', 'detailEditorInst', r.body, true, md => { this.bodyDraft = md }) })
			}
		},
		closeDetail() { this.detach(this._detailHost); this.editingBody = false; this.videoPlaying = false; this.revokePdf(); this.detailOpen = false },
		async loadPdfBlob(r) { try { const { data } = await axios.get(this.fileUrl(r), { responseType: 'blob' }); this.pdfBlobUrl = URL.createObjectURL(data) } catch (e) { this.toast(this.tr('Could not load the PDF.'), 'error') } },
		revokePdf() { if (this.pdfBlobUrl) { URL.revokeObjectURL(this.pdfBlobUrl); this.pdfBlobUrl = null } },
		fileUrl(r) { return api('/references/' + r.id + '/file') },
		startTitle() { this.titleDraft = this.detailRef.title || ''; this.editingTitle = true },
		async saveTitle() { const t = this.titleDraft.trim(); if (!t || t === this.detailRef.title) { this.editingTitle = false; return } try { await this.patch({ title: t }); this.editingTitle = false } catch (e) { /* patch shows the server error */ } },
		// Description + Note are always-editable inline fields (like the comment/tag
		// inputs): they save on blur or Ctrl/Cmd+Enter, no Edit/Save toggle.
		autoGrow(e) { const el = e.target; el.style.height = 'auto'; el.style.height = Math.max(60, el.scrollHeight) + 'px' },
		blurField(e) { if (e && e.target && e.target.blur) e.target.blur() },
		growInlineFields() { this.$nextTick(() => { setTimeout(() => { const root = this.$el; if (!root) return; root.querySelectorAll('.modal.detail .inlinefield').forEach(el => { el.style.height = 'auto'; el.style.height = Math.max(60, el.scrollHeight) + 'px' }) }, 20) }) },
		async saveDescField(e) { const v = e.target.value; if (!this.detailRef || v === (this.detailRef.desc || '')) return; await this.patch({ desc: v }) },
		async saveNoteField(e) { const v = e.target.value; if (!this.detailRef || v === (this.detailRef.note || '')) return; await this.patch({ note: v }) },
		async saveLinkField(e) { const v = (e.target.value || '').trim(); if (!this.detailRef || v === (this.detailRef.source_url || '')) return; await this.patch({ source_url: v || null }) },

		/* ---- geolocation ---- */
		geoApplicable(r) { return !!r && ['image', 'image_url', 'video', 'link'].includes(r.type) },
		geoSourceLabel(r) {
			const m = { exif: this.tr('from photo'), video: this.tr('from video'), page: this.tr('from page'), geocoded: this.tr('suggested'), manual: this.tr('added by you') }
			return (r && m[r.geoSource]) || ''
		},
		geoLabel(r) { return r.place || (Number(r.lat).toFixed(4) + ', ' + Number(r.lng).toFixed(4)) },
		mapsUrl(r) { const la = Number(r.lat), ln = Number(r.lng); return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=13/${la}/${ln}` },
		// Enter in the detail place field: take the highlighted/first suggestion if the
		// typeahead has any, else geocode the typed text directly (exact address path).
		geoEnter() { if (this.geoSug.length) { this.pickGeoSug(this.geoSug[0]) } else { this.geocodePlace() } },
		async geocodePlace() {
			const q = (this.geoPlaceInput.trim() || (this.detailRef && this.detailRef.title) || '').trim()
			if (!q || this.geoBusy) return
			this.geoBusy = true; this.geoMsg = ''
			try {
				const { data } = await axios.get(api('/geocode'), { params: { q } })
				const res = data && data.result
				if (res) { await this.patch({ lat: res.lat, lng: res.lng, place: res.place, geoSource: 'manual' }); this.geoPlaceInput = '' } else { this.geoMsg = this.tr('No match for that place.') }
			} catch (e) { this.geoMsg = this.tr('Could not look up that place.') } finally { this.geoBusy = false }
		},
		async clearGeo() { await this.patch({ lat: null, lng: null, place: null }) },
		// NC UI locale so Nominatim returns place names in the user's language (C2).
		ncLang() { try { if (window.OC && OC.getCanonicalLocale) return OC.getCanonicalLocale() || ''; if (window.OC && OC.getLocale) return OC.getLocale() || '' } catch (e) {} return navigator.language || '' },
		// Debounced typeahead against /api/geocode/suggest (>=380ms; Nominatim ~1 req/s).
		geoSuggest(q, cb) {
			if (this._geoTimer) clearTimeout(this._geoTimer)
			const query = (q || '').trim()
			if (query.length < 3) { cb([]); return }
			this._geoTimer = setTimeout(async () => {
				try {
					const { data } = await axios.get(api('/geocode/suggest'), { params: { q: query, lang: this.ncLang() } })
					cb(Array.isArray(data && data.results) ? data.results : [])
				} catch (e) { cb([]) }
			}, 380)
		},
		onGeoInput() { this.geoSuggest(this.geoPlaceInput, arr => { this.geoSug = arr }) },
		onGeoBlur() { setTimeout(() => { this.geoSug = [] }, 150) },
		async pickGeoSug(s) { this.geoSug = []; this.geoPlaceInput = ''; this.geoMsg = ''; await this.patch({ lat: s.lat, lng: s.lng, place: s.place, geoSource: 'manual' }) },
		/* add-dialog location (C1) */
		onAddGeoInput() { this.geoSuggest(this.addGeoQuery, arr => { this.addGeoSug = arr }) },
		onAddGeoBlur() { setTimeout(() => { this.addGeoSug = [] }, 150) },
		pickAddGeoSug(s) { this.addGeo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' }; this.addGeoSug = []; this.addGeoQuery = '' },
		pickFirstAddGeo() { if (this.addGeoSug.length) this.pickAddGeoSug(this.addGeoSug[0]) },
		suggestionShort(s) { return s && s.place ? String(s.place).split(',')[0] : '' },
		// Is this suggestion the one currently selected? (so its chip shows as active).
		isAddGeoSelected(s) { return !!(s && this.addGeo && Math.abs(Number(this.addGeo.lat) - Number(s.lat)) < 1e-6 && Math.abs(Number(this.addGeo.lng) - Number(s.lng)) < 1e-6) },
		// Pick a suggested place. Keep the chips visible so the user can switch to another one, or
		// clear the selection (the location field's X) and pick again.
		acceptAddGeoSuggestion(s) { if (!s) return; this.addGeo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' } },
		// Infer a location suggestion from the fetched title/description (heuristic; the
		// user confirms it). One request, only when no embedded page geo was found.
		async inferAddGeo() {
			// Ask the backend to detect a location from the title / description / hashtags
			// (it extracts candidates, geocodes them, and keeps only real places). Runs only
			// when no embedded page geo was found; one call, best-effort. Prefer the RAW
			// caption (pre-cleanup) so a place inside a stripped prefix / sentence / truncated
			// tail is still visible; fall back to the shown fields (e.g. manual text add).
			const title = ((this._rawTitle || this.addTitle) || '').trim();
			const desc = ((this._rawDesc || this.addDesc) || '').trim();
			if (!title && !desc) return;
			const tags = ((title + ' ' + desc).match(/#[\p{L}0-9_]+/gu) || [])
				.concat((this.addHashtags || []).map(h => '#' + h)).join(' ');
			// Guard against a slow detection from a PREVIOUS link landing on the current
			// dialog (the reported "suggests the last url's location" bug): only the newest
			// call may set the suggestion.
			const seq = (this._geoSeq = (this._geoSeq || 0) + 1);
			// Show a "Detecting location…" hint while the (multi-second, ~1 req/s) geocoding runs,
			// so the suggestion doesn't seem to appear only after the field is touched.
			this.addGeoBusy = true;
			try {
				const { data } = await axios.get(api('/geocode/detect'), { params: { title, desc, hashtags: tags, lang: this.ncLang() } });
				if (seq !== this._geoSeq) return; // a newer fetch superseded this one
				const list = (data && Array.isArray(data.results)) ? data.results : (data && data.result ? [data.result] : []);
				if (list.length && !this.addGeo) this.addGeoSuggestions = list.map(r => ({ lat: r.lat, lng: r.lng, place: r.place }));
			} catch (e) { /* detection is best-effort */ } finally { if (seq === this._geoSeq) this.addGeoBusy = false; }
		},

		/* ---- map view (D) ---- */
		// CARTO minimalist basemaps, switched with the theme. Tiles are images so the
		// existing img CSP ('*') covers them; Leaflet + markercluster are bundled (no CDN).
		mapTiles() {
			const dark = this.theme === 'dark';
			return {
				url: 'https://{s}.basemaps.cartocdn.com/' + (dark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}{r}.png',
				opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' },
			};
		},
		// Rounded-square thumbnail tile for a ref (used by both single markers and the
		// cluster's representative image). `badge` = a count shown top-right (clusters).
		markerTileHtml(r, badge) {
			const bg = grad(r.seed * 2);
			const img = this.hasThumb(r) ? `<img src="${this.thumbUrl(r)}" loading="lazy" onerror="this.style.display='none'">` : '';
			// Badge is a SIBLING of the (overflow-hidden) thumbnail so the corner count isn't clipped.
			const b = badge ? `<span class="rb-cluster-badge">${badge}</span>` : '';
			return `<div class="rb-marker-wrap"><div class="rb-marker-in" style="background:${bg}">${img}</div>${b}</div>`;
		},
		buildMap() {
			if (this._map || !this.$refs.mapEl) return;
			const map = L.map(this.$refs.mapEl, { zoomControl: true, attributionControl: true, worldCopyJump: true, maxBoundsViscosity: 1.0 });
			// Clamp LATITUDE to the map's edges so you can never pan or zoom out past the top or
			// bottom of the map (the dark gutters). Longitude is left effectively free (very wide
			// bounds) so the world still wraps horizontally to fill a wide container.
			const SOUTH = -85.05112878, NORTH = 85.05112878;
			map.setMaxBounds(L.latLngBounds([[SOUTH, -9000], [NORTH, 9000]]));
			// Minimum zoom = the level at which the full latitude span fills the viewport height,
			// so dezooming can never reveal a gutter above or below the map. Recomputed on resize
			// (the map area is a short, wide strip whose height changes with the window).
			this._clampMinZoom = () => {
				if (!this._map || !this.$refs.mapEl) return;
				const h = this.$refs.mapEl.clientHeight;
				if (!h) return;
				this._map.setMinZoom(Math.max(1, Math.ceil(Math.log2(h / 256))));
			};
			map.on('resize', this._clampMinZoom);
			const t = this.mapTiles();
			this._tiles = L.tileLayer(t.url, t.opts).addTo(map);
			this._cluster = L.markerClusterGroup({
				showCoverageOnHover: false,
				maxClusterRadius: 48,
				iconCreateFunction: (cluster) => {
					// Cluster = a rounded-square thumbnail of a representative reference with
					// a count badge in the top-right corner.
					const first = cluster.getAllChildMarkers()[0];
					const r = first && first.options.rbRef;
					const count = cluster.getChildCount();
					const html = r ? this.markerTileHtml(r, count)
						: `<div class="rb-marker-in" style="background:var(--primary)"><span class="rb-cluster-badge">${count}</span></div>`;
					return L.divIcon({ html, className: 'rb-marker', iconSize: [46, 46], iconAnchor: [23, 23] });
				},
			});
			map.addLayer(this._cluster);
			this._map = map;
			this.refreshMapMarkers();
			this.$nextTick(() => { if (this._map) { this._map.invalidateSize(); this._clampMinZoom(); } });
		},
		refreshMapMarkers() {
			if (!this._map || !this._cluster) return;
			this._cluster.clearLayers();
			const refs = this.locatedRefs;
			const markers = refs.map(r => {
				const m = L.marker([Number(r.lat), Number(r.lng)], {
					icon: L.divIcon({ html: this.markerTileHtml(r, null), className: 'rb-marker', iconSize: [46, 46], iconAnchor: [23, 23], popupAnchor: [0, -22] }),
					title: r.title || '',
					rbRef: r, // used by the cluster icon to pick a representative thumbnail
				});
				m.on('click', () => this.openDetail(r));
				return m;
			});
			this._cluster.addLayers(markers);
			this.fitMap(refs);
		},
		fitMap(refs) {
			if (!this._map) return;
			if (!refs.length) { this._map.setView([20, 0], 2); return; }
			if (refs.length === 1) { this._map.setView([Number(refs[0].lat), Number(refs[0].lng)], 12); return; }
			const bounds = L.latLngBounds(refs.map(r => [Number(r.lat), Number(r.lng)]));
			this._map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
		},
		swapMapTiles() {
			if (!this._map) return;
			if (this._tiles) { this._map.removeLayer(this._tiles); }
			const t = this.mapTiles();
			this._tiles = L.tileLayer(t.url, t.opts).addTo(this._map);
		},
		destroyMap() {
			if (this._map) { try { this._map.remove(); } catch (e) { /* already gone */ } }
			this._map = null; this._cluster = null; this._tiles = null;
		},

		/* ---- manual image crop (B3) ---- */
		openCrop() {
			if (!this.addImg) return
			this.cropSrc = this.addImg
			this.cropSrcRef = this.addUploadMarker || this.addImg
			this.cropBusy = false
			this.cropBox = { x: 0, y: 0, w: 0, h: 0 }
			this.cropImgW = 0; this.cropImgH = 0
			this.cropOpen = true
		},
		onCropImgLoad(e) {
			const img = e.target
			this.cropImgW = img.clientWidth
			this.cropImgH = img.clientHeight
			const w = Math.round(this.cropImgW * 0.8), h = Math.round(this.cropImgH * 0.8)
			this.cropBox = { x: Math.round((this.cropImgW - w) / 2), y: Math.round((this.cropImgH - h) / 2), w, h }
		},
		cropStart(e, mode) {
			this._cropDrag = { mode, sx: e.clientX, sy: e.clientY, box: { ...this.cropBox } }
			this._cropMove = (ev) => this.onCropMove(ev)
			this._cropUp = () => this.onCropUp()
			window.addEventListener('mousemove', this._cropMove)
			window.addEventListener('mouseup', this._cropUp)
		},
		onCropMove(e) {
			const d = this._cropDrag; if (!d) return
			const dx = e.clientX - d.sx, dy = e.clientY - d.sy, iw = this.cropImgW, ih = this.cropImgH, min = 24
			const o = d.box
			if (d.mode === 'move') {
				const x = Math.min(Math.max(0, o.x + dx), iw - o.w), y = Math.min(Math.max(0, o.y + dy), ih - o.h)
				this.cropBox = { x: Math.round(x), y: Math.round(y), w: o.w, h: o.h }
				return
			}
			let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h
			if (d.mode.includes('e')) right = Math.min(iw, Math.max(left + min, right + dx))
			if (d.mode.includes('w')) left = Math.max(0, Math.min(right - min, left + dx))
			if (d.mode.includes('s')) bottom = Math.min(ih, Math.max(top + min, bottom + dy))
			if (d.mode.includes('n')) top = Math.max(0, Math.min(bottom - min, top + dy))
			this.cropBox = { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) }
		},
		onCropUp() {
			window.removeEventListener('mousemove', this._cropMove)
			window.removeEventListener('mouseup', this._cropUp)
			this._cropDrag = null
		},
		async applyCrop() {
			if (this.cropBusy || !this.cropImgW || !this.cropImgH) return
			const b = this.cropBox
			const fx = b.x / this.cropImgW, fy = b.y / this.cropImgH, fw = b.w / this.cropImgW, fh = b.h / this.cropImgH
			this.cropBusy = true
			try {
				const { data } = await axios.post(api('/crop'), { src: this.cropSrcRef, x: fx, y: fy, w: fw, h: fh })
				this.addImg = data.preview
				this.addUploadMarker = data.img
				this.addFetchType = 'image_url'
				this.cropOpen = false
			} catch (e) { this.toast(this.tr('Could not crop the image.'), 'error') } finally { this.cropBusy = false }
		},
		toggleBody() {
			if (this.textEditorReady && this.detailEditorInst) {
				if (!this.editingBody) { this.editingBody = true; this.detailEditorInst.setReadOnly(false); this.detailEditorInst.focus?.() } else { this.saveBody() }
				return
			}
			if (!this.editingBody) { this.bodyDraft = this.detailRef.body || ''; this.editingBody = true } else { this.saveBody() }
		},
		async patch(fields) { try { const { data } = await axios.put(api('/references/' + this.detailRef.id), fields); Object.assign(this.detailRef, { ...data, _sel: this.detailRef._sel }); return data } catch (e) { this.toast(this.tr('Could not save changes.'), 'error'); throw e } },
		async saveBody() { await this.patch({ body: this.bodyDraft }); this.editingBody = false; if (this.detailEditorInst) this.detailEditorInst.setReadOnly(true) },
		async commitDetailTag() { const n = this.detailTagInput.trim(); if (!n) return; const t = await this.resolveTag(n); const ids = this.detailRef.tags.map(x => x.id); if (!ids.includes(t.id)) ids.push(t.id); await this.patch({ tagIds: ids }); this.detailTagInput = '' },
		async removeDetailTag(tag) { const ids = this.detailRef.tags.map(x => x.id).filter(id => id !== tag.id); await this.patch({ tagIds: ids }) },
		async postComment() { const v = this.commentText.trim(); if (!v) return; const { data } = await axios.post(api('/references/' + this.detailRef.id + '/comments'), { message: v }); this.detailRef.comments.push(data); this.commentText = '' },
		async deleteComment(c) { try { await axios.delete(api('/comments/' + c.id)); const i = this.detailRef.comments.indexOf(c); if (i >= 0) this.detailRef.comments.splice(i, 1) } catch (e) { /* ignore */ } },
		async deleteDetail() { const id = this.detailRef.id; try { await axios.delete(api('/references/' + id)); this.references = this.references.filter(r => r.id !== id); this.closeDetail() } catch (e) { this.toast(this.tr('Could not delete the reference.'), 'error') } },

		async deleteSelected() { let failed = 0; for (const r of this.selected.slice()) { try { await axios.delete(api('/references/' + r.id)); this.references = this.references.filter(x => x.id !== r.id) } catch (e) { failed++ } } if (failed) this.toast(this.tr('{n} item(s) could not be deleted.', { n: failed }), 'error') },

		/* bulk tag */
		openBulk() { this.bulkPending = {}; this.bulkSearch = ''; this.bulkOpen = true; this.focusRef('bulkSearchField') },
		tagState(t) { const sel = this.selected; const n = sel.filter(r => r.tags.some(x => x.id === t.id)).length; if (n === 0) return 'none'; if (n === sel.length) return 'all'; return 'some' },
		bulkState(t) { const p = this.bulkPending[t.id]; if (p === 'add') return 'all'; if (p === 'remove') return 'none'; return this.tagState(t) },
		bulkToggle(t) { this.bulkPending = { ...this.bulkPending, [t.id]: this.bulkState(t) === 'all' ? 'remove' : 'add' } },
		// Enter in the search/create field mirrors the visible "Create" row: if the
		// typed name is new, create + select it; if it names an existing tag, toggle it.
		bulkEnter() {
			const q = this.bulkSearch.trim(); if (!q) return
			const ex = this.tagByName(q)
			if (ex) { this.bulkToggle(ex); this.bulkSearch = '' } else { this.bulkCreate() }
		},
		async bulkCreate() { const t = await this.resolveTag(this.bulkSearch.trim()); this.bulkPending = { ...this.bulkPending, [t.id]: 'add' }; this.bulkSearch = '' },
		async applyBulk() {
			const add = []; const remove = []
			for (const [id, act] of Object.entries(this.bulkPending)) { if (act === 'add') add.push(+id); else remove.push(+id) }
			const refIds = this.selected.map(r => r.id)
			try {
				await axios.post(api('/references/bulk-tag'), { refIds, addTagIds: add, removeTagIds: remove })
				for (const r of this.selected) {
					for (const id of add) { const t = this.tags.find(x => x.id === id); if (t && !r.tags.some(x => x.id === id)) r.tags.push({ id: t.id, name: t.name, color: t.color }) }
					for (const id of remove) { const i = r.tags.findIndex(x => x.id === id); if (i >= 0) r.tags.splice(i, 1) }
				}
				this.bulkOpen = false
			} catch (e) { /* ignore */ }
		},

		/* ---- management: folders / tags / boards ---- */
		focusRef(name) { this.$nextTick(() => { setTimeout(() => { const el = this.$refs[name]; if (el && el.focus) { el.focus(); if (el.select) el.select() } }, 30) }) },
		// Escape closes the topmost open overlay, consistently across menus. The detail
		// modal is intentionally excluded: it holds inline editors, and closing on Escape
		// would drop unsaved edits; it keeps its own close button.
		onKeydown(e) {
			if (e.key !== 'Escape') return
			if (this.typeMenuOpen) { this.typeMenuOpen = false; return }
			if (this.cropOpen) { this.cropOpen = false; return }
			// scrim-top prompts (input / tag / board) sit above the manage modals, so close them first
			if (this.inputOpen) { this.inputOpen = false; return }
			if (this.tagOpen) { this.tagOpen = false; return }
			if (this.boardOpen) { this.boardOpen = false; return }
			if (this.shareOpen) { this.shareOpen = false; return }
			if (this.addOpen) { this.closeAdd(); return }
			if (this.bulkOpen) { this.bulkOpen = false; return }
			if (this.manageTagsOpen) { this.manageTagsOpen = false; return }
			if (this.manageBoardsOpen) { this.manageBoardsOpen = false; return }
			if (this.settingsOpen) { this.settingsOpen = false; return }
		},
		openInput(title, value, cb, placeholder = '') { this.inputTitle = title; this.inputValue = value || ''; this.inputPlaceholder = placeholder; this.inputCb = cb; this.inputOpen = true; this.focusRef('inputField') },
		async saveInput() { const v = this.inputValue.trim(); const cb = this.inputCb; this.inputOpen = false; if (v && cb) await cb(v) },

		newFolder() { this.openInput(this.tr('New folder'), '', async (name) => {
			if (this.folders.some(f => (f.name || '').toLowerCase() === name.toLowerCase())) { this.toast(this.tr('A folder named "{name}" already exists.', { name }), 'error'); return }
			const { data } = await axios.post(api('/folders'), { name }); this.folders.push({ ...data })
		}, 'Folder name') },
		renameFolder(f) { this.openInput(this.tr('Rename folder'), f.name, async (name) => { await axios.put(api('/folders/' + f.id), { name }); f.name = name }) },
		async deleteFolder(f) { if (!window.confirm(this.tr('Delete folder "{name}"? Its tags become ungrouped.', { name: f.name }))) return; await axios.delete(api('/folders/' + f.id)); this.folders = this.folders.filter(x => x.id !== f.id); this.tags.forEach(t => { if (t.folder === f.id) t.folder = null }) },

		openTagModal(tag, folderId) { this.tagEditId = tag ? tag.id : null; this.tagName = tag ? tag.name : ''; this.tagColor = tag ? (tag.color || this.palette[0]) : this.palette[Math.floor(Math.random() * this.palette.length)]; this.tagFolder = tag ? (tag.folder ?? null) : (folderId ?? null); this.tagOpen = true; this.focusRef('tagNameField') },
		async saveTag() {
			const name = this.tagName.trim(); if (!name) return
			// Block a duplicate name on create (editing an existing tag keeps its own name).
			if (!this.tagEditId && this.tags.some(t => (t.name || '').toLowerCase() === name.toLowerCase())) { this.toast(this.tr('A tag named "{name}" already exists.', { name }), 'error'); return }
			if (this.tagEditId) {
				const { data } = await axios.put(api('/tags/' + this.tagEditId), { name, color: this.tagColor, folder: this.tagFolder })
				const t = this.tags.find(x => x.id === this.tagEditId); if (t) Object.assign(t, data)
				this.references.forEach(r => r.tags.forEach(rt => { if (rt.id === this.tagEditId) { rt.name = data.name; rt.color = data.color } }))
			} else { const { data } = await axios.post(api('/tags'), { name, color: this.tagColor, folder: this.tagFolder }); this.tags.push(data) }
			this.tagOpen = false
		},
		async deleteTag(t) { if (!window.confirm(this.tr('Delete tag "{name}"?', { name: t.name }))) return; await axios.delete(api('/tags/' + t.id)); this.tags = this.tags.filter(x => x.id !== t.id); this.references.forEach(r => { r.tags = r.tags.filter(rt => rt.id !== t.id) }); const i = this.shownTags.indexOf(t.name); if (i >= 0) this.shownTags.splice(i, 1) },

		newBoard() { this.openBoardModal(null) },
		openBoardModal(b) { this.boardEditId = b ? b.id : null; this.boardName = b ? b.name : ''; this.boardColor = b ? (b.color || this.palette[8]) : this.palette[8]; this.boardLocation = b ? (b.location || '') : ''; this.boardOpen = true; this.focusRef('boardNameField') },
		async saveBoard() {
			const name = this.boardName.trim(); if (!name) return
			const location = this.boardLocation.trim() || undefined
			try {
				if (this.boardEditId) { const { data } = await axios.put(api('/boards/' + this.boardEditId), { name, color: this.boardColor, location }); const b = this.boards.find(x => x.id === this.boardEditId); if (b) Object.assign(b, data) } else { const { data } = await axios.post(api('/boards'), { name, color: this.boardColor, location }); this.boards.forEach(x => { x.visible = false }); this.boards.push({ ...data, visible: true }) }
				this.boardOpen = false
			} catch (e) { window.alert((e.response && e.response.data && e.response.data.error) || this.tr('Could not save the board.')) }
		},
		// Open the delete-board confirmation. The actual delete now removes the board's Nextcloud
		// folder and all its contents (see confirmDeleteBoard), so the warning is explicit.
		deleteBoard(b) { this.deleteConfirm = b },
		async confirmDeleteBoard() {
			const b = this.deleteConfirm
			if (!b || this.deletingBoard) return
			this.deletingBoard = true
			try {
				await axios.delete(api('/boards/' + b.id))
				this.references = this.references.filter(r => r.board !== b.id)
				this.boards = this.boards.filter(x => x.id !== b.id)
				if (!this.boards.some(x => x.visible) && this.boards[0]) this.boards[0].visible = true
				this.deleteConfirm = null
			} catch (e) {
				this.toast(this.tr('Could not delete the board.'), 'error')
			} finally { this.deletingBoard = false }
		},
		shareBoardPrompt(b) { this.shareBoardRef = b; this.shareUser = ''; this.sharePerm = 'edit'; this.shareMsg = ''; this.shareOpen = true; this.focusRef('shareUserField') },
		async doShare() {
			const uid = this.shareUser.trim(); if (!uid || this.sharing) return
			this.sharing = true; this.shareMsg = ''
			try {
				const { data } = await axios.post(api('/boards/' + this.shareBoardRef.id + '/share'), { shareWith: uid, permissions: this.sharePerm })
				this.shareBoardRef.sharedWith = data.sharedWith || this.shareBoardRef.sharedWith
				this.shareUser = ''
			} catch (e) { this.shareMsg = (e.response && e.response.data && e.response.data.error) || this.tr('Could not share (unknown user?)') } finally { this.sharing = false }
		},
		async changeShareLevel(u, level) {
			if (u.level === level) return
			try {
				const { data } = await axios.post(api('/boards/' + this.shareBoardRef.id + '/share'), { shareWith: u.uid, permissions: level })
				this.shareBoardRef.sharedWith = data.sharedWith || this.shareBoardRef.sharedWith
			} catch (e) { this.shareMsg = (e.response && e.response.data && e.response.data.error) || this.tr('Could not change access.') }
		},
		async unshareBoard(b, uid) { try { await axios.delete(api('/boards/' + b.id + '/share'), { params: { shareWith: uid } }); b.sharedWith = (b.sharedWith || []).filter(u => u.uid !== uid) } catch (e) { this.shareMsg = this.tr('Could not remove access.') } },

		tagRefCountAll(name) { return this.references.filter(r => r.tags.some(t => t.name === name)).length },
	},
}
</script>

<style src="./styles.css"></style>
