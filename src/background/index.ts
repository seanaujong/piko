import type { ExtensionRequest } from '../shared/messages'
import { checkFrameability } from './frameability'

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  switch (message.type) {
    case 'CHECK_FRAMEABILITY':
      checkFrameability(message.targetUrl, message.pageOrigin).then(sendResponse)
      return true // keep the message channel open for the async sendResponse above
    default: {
      const exhaustive: never = message.type
      return exhaustive
    }
  }
})
