// Where webpack loads lazy chunks (the map engine) from. Set at runtime because the
// app may live in apps/ or custom_apps/, and Nextcloud may sit in a subfolder.
import { generateFilePath } from '@nextcloud/router'

// eslint-disable-next-line no-undef, camelcase
__webpack_public_path__ = generateFilePath('curio', '', 'js/')
