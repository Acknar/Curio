import { createApp } from 'vue'
import App from './App.vue'

function boot() {
	const el = document.getElementById('curio-root')
	if (el) {
		createApp(App).mount(el)
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot)
} else {
	boot()
}
