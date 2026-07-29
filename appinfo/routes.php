<?php

declare(strict_types=1);

return [
	'routes' => [
		// page
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],

		// bootstrap state
		['name' => 'api#state', 'url' => '/api/state', 'verb' => 'GET'],

		// boards
		['name' => 'api#createBoard', 'url' => '/api/boards', 'verb' => 'POST'],
		['name' => 'api#updateBoard', 'url' => '/api/boards/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteBoard', 'url' => '/api/boards/{id}', 'verb' => 'DELETE'],
		['name' => 'api#shareBoard', 'url' => '/api/boards/{id}/share', 'verb' => 'POST'],
		['name' => 'api#unshareBoard', 'url' => '/api/boards/{id}/share', 'verb' => 'DELETE'],
		['name' => 'api#exportBoard', 'url' => '/api/boards/{id}/export', 'verb' => 'GET'],
		['name' => 'api#importBoard', 'url' => '/api/boards/{id}/import', 'verb' => 'POST'],

		// references
		['name' => 'api#fetch', 'url' => '/api/fetch', 'verb' => 'POST'],
		['name' => 'api#geocode', 'url' => '/api/geocode', 'verb' => 'GET'],
		['name' => 'api#geocodeSuggest', 'url' => '/api/geocode/suggest', 'verb' => 'GET'],
		['name' => 'api#geocodeDetect', 'url' => '/api/geocode/detect', 'verb' => 'GET'],
		['name' => 'api#crop', 'url' => '/api/crop', 'verb' => 'POST'],
		['name' => 'api#upload', 'url' => '/api/upload', 'verb' => 'POST'],
		['name' => 'api#createReference', 'url' => '/api/references', 'verb' => 'POST'],
		['name' => 'api#bulkTag', 'url' => '/api/references/bulk-tag', 'verb' => 'POST'],
		['name' => 'api#thumbnail', 'url' => '/api/references/{id}/thumbnail', 'verb' => 'GET'],
		['name' => 'api#file', 'url' => '/api/references/{id}/file', 'verb' => 'GET'],
		['name' => 'api#updateReference', 'url' => '/api/references/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteReference', 'url' => '/api/references/{id}', 'verb' => 'DELETE'],
		['name' => 'api#addComment', 'url' => '/api/references/{id}/comments', 'verb' => 'POST'],
		['name' => 'api#deleteComment', 'url' => '/api/comments/{id}', 'verb' => 'DELETE'],

		// tags
		['name' => 'api#createTag', 'url' => '/api/tags', 'verb' => 'POST'],
		['name' => 'api#updateTag', 'url' => '/api/tags/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteTag', 'url' => '/api/tags/{id}', 'verb' => 'DELETE'],

		// folders
		['name' => 'api#createFolder', 'url' => '/api/folders', 'verb' => 'POST'],
		['name' => 'api#updateFolder', 'url' => '/api/folders/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteFolder', 'url' => '/api/folders/{id}', 'verb' => 'DELETE'],

		// settings
		['name' => 'api#getSettings', 'url' => '/api/settings', 'verb' => 'GET'],
		['name' => 'api#updateSettings', 'url' => '/api/settings', 'verb' => 'PUT'],

		// base folder (first-run setup)
		['name' => 'api#setBaseFolder', 'url' => '/api/base-folder', 'verb' => 'POST'],
		['name' => 'api#browseFolders', 'url' => '/api/folders/browse', 'verb' => 'GET'],
	],
];
