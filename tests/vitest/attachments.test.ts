import { draggable } from '$lib/attachments'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type MockElement = HTMLElement & {
  style: {
    setProperty: ReturnType<typeof vi.fn>
    cursor: string
    left: string
    top: string
    width: string
    right: string
  }
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  querySelector: ReturnType<typeof vi.fn>
  contains: ReturnType<typeof vi.fn>
}

// Test utilities
function create_mock_element(): MockElement {
  const style = {
    setProperty: vi.fn(),
    cursor: ``,
    left: ``,
    top: ``,
    width: ``,
    right: ``,
  }

  const element = {
    offsetLeft: 100,
    offsetTop: 50,
    offsetWidth: 200,
    style,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelector: vi.fn(),
    contains: vi.fn((node: Node) => {
      // Mock contains method - return true if node is this element
      return node === element
    }),
  } as MockElement

  return element
}

function create_mock_event(
  type: string,
  target: unknown = undefined,
  clientX = 100,
  clientY = 50,
): MouseEvent {
  return {
    type,
    clientX,
    clientY,
    target: target || null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent
}

function get_event_handler(
  element: MockElement,
  eventType: string,
): (event: MouseEvent) => void {
  const call = element.addEventListener.mock.calls.find(([type]) => type === eventType)
  if (!call) throw new Error(`No ${eventType} handler found`)
  return call[1]
}

function get_global_handler(eventType: string): (event: MouseEvent) => void {
  const globalMock = globalThis.addEventListener as ReturnType<typeof vi.fn>
  const call = globalMock.mock.calls.find(([type]) => type === eventType)
  if (!call) throw new Error(`No global ${eventType} handler found`)
  return call[1]
}

describe(`draggable attachment`, () => {
  let element: MockElement
  let handle: MockElement
  let userSelectSetter: ReturnType<typeof vi.fn>

  beforeEach(() => {
    element = create_mock_element()
    handle = create_mock_element()
    userSelectSetter = vi.fn()

    Object.defineProperty(document.body.style, `userSelect`, {
      set: userSelectSetter,
      get: () => ``,
      configurable: true,
    })

    globalThis.addEventListener = vi.fn()
    globalThis.removeEventListener = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe(`initialization`, () => {
    test(`should setup default draggable element`, () => {
      const attachment = draggable()
      const cleanup = attachment(element)

      expect(element.style.cursor).toBe(`grab`)
      expect(element.addEventListener).toHaveBeenCalledWith(
        `mousedown`,
        expect.any(Function),
      )
      expect(cleanup).toBeTypeOf(`function`)
    })

    test(`should use custom handle when provided`, () => {
      element.querySelector.mockReturnValue(handle)

      const attachment = draggable({ handle_selector: `.handle` })
      const cleanup = attachment(element)

      expect(element.querySelector).toHaveBeenCalledWith(`.handle`)
      expect(handle.style.cursor).toBe(`grab`)
      expect(handle.addEventListener).toHaveBeenCalledWith(
        `mousedown`,
        expect.any(Function),
      )
      expect(element.addEventListener).not.toHaveBeenCalled()
      expect(cleanup).toBeTypeOf(`function`)
    })

    test(`should handle missing handle gracefully`, () => {
      element.querySelector.mockReturnValue(null)
      const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

      const attachment = draggable({ handle_selector: `.missing` })
      const cleanup = attachment(element)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`handle not found`))
      expect(cleanup).toBeUndefined()
      consoleSpy.mockRestore()
    })
  })

  describe(`drag interaction`, () => {
    test.each([
      { description: `element as handle`, useHandle: false },
      { description: `custom handle`, useHandle: true },
    ])(`should complete full drag cycle with $description`, ({ useHandle }) => {
      const callbacks = {
        on_drag_start: vi.fn(),
        on_drag: vi.fn(),
        on_drag_end: vi.fn(),
      }

      let targetElement: MockElement
      if (useHandle) {
        element.querySelector.mockReturnValue(handle)
        const attachment = draggable({ handle_selector: `.handle`, ...callbacks })
        attachment(element)
        targetElement = handle
      } else {
        const attachment = draggable(callbacks)
        attachment(element)
        targetElement = element
      }

      const mousedownHandler = get_event_handler(targetElement, `mousedown`)

      // Start drag
      const startEvent = create_mock_event(`mousedown`, targetElement, 150, 75)
      mousedownHandler(startEvent)

      // Verify drag start
      expect(callbacks.on_drag_start).toHaveBeenCalledWith(startEvent)
      expect(element.style.left).toBe(`100px`)
      expect(element.style.top).toBe(`50px`)
      expect(element.style.width).toBe(`200px`)
      expect(element.style.right).toBe(`auto`)
      expect(userSelectSetter).toHaveBeenCalledWith(`none`)
      expect(targetElement.style.cursor).toBe(`grabbing`)

      // Continue drag
      const mousemoveHandler = get_global_handler(`mousemove`)
      const moveEvent = create_mock_event(`mousemove`, targetElement, 200, 125)
      mousemoveHandler(moveEvent)

      expect(callbacks.on_drag).toHaveBeenCalledWith(moveEvent)
      expect(element.style.left).toBe(`150px`)
      expect(element.style.top).toBe(`100px`)

      // End drag
      const mouseupHandler = get_global_handler(`mouseup`)
      const endEvent = create_mock_event(`mouseup`, targetElement, 200, 125)
      mouseupHandler(endEvent)

      expect(callbacks.on_drag_end).toHaveBeenCalledWith(endEvent)
      expect(userSelectSetter).toHaveBeenCalledWith(``)
      expect(targetElement.style.cursor).toBe(`grab`)
      expect(endEvent.stopPropagation).toHaveBeenCalled()
    })

    test(`should ignore drag from wrong target`, () => {
      const on_drag_start = vi.fn()
      const attachment = draggable({ on_drag_start })
      attachment(element)

      const mousedownHandler = get_event_handler(element, `mousedown`)
      const wrongTarget = create_mock_element()
      element.contains.mockReturnValue(false)

      const startEvent = create_mock_event(`mousedown`, wrongTarget)
      mousedownHandler(startEvent)

      expect(on_drag_start).not.toHaveBeenCalled()
    })

    test(`should prevent text selection during drag`, () => {
      const attachment = draggable()
      attachment(element)

      const mousedownHandler = get_event_handler(element, `mousedown`)
      const startEvent = create_mock_event(`mousedown`, element)
      mousedownHandler(startEvent)

      expect(userSelectSetter).toHaveBeenCalledWith(`none`)
    })
  })

  describe(`cleanup`, () => {
    test(`should remove event listeners on cleanup`, () => {
      const attachment = draggable()
      const cleanup = attachment(element)

      expect(element.addEventListener).toHaveBeenCalledWith(
        `mousedown`,
        expect.any(Function),
      )

      cleanup?.()

      expect(element.removeEventListener).toHaveBeenCalledWith(
        `mousedown`,
        expect.any(Function),
      )
      expect(element.style.cursor).toBe(``)
    })

    test(`should remove global listeners during drag cleanup`, () => {
      const attachment = draggable()
      attachment(element)

      const mousedownHandler = get_event_handler(element, `mousedown`)
      const startEvent = create_mock_event(`mousedown`, element)
      mousedownHandler(startEvent)

      expect(globalThis.addEventListener).toHaveBeenCalledWith(
        `mousemove`,
        expect.any(Function),
      )
      expect(globalThis.addEventListener).toHaveBeenCalledWith(
        `mouseup`,
        expect.any(Function),
      )

      const mouseupHandler = get_global_handler(`mouseup`)
      const endEvent = create_mock_event(`mouseup`)
      mouseupHandler(endEvent)

      expect(globalThis.removeEventListener).toHaveBeenCalledWith(
        `mousemove`,
        expect.any(Function),
      )
      expect(globalThis.removeEventListener).toHaveBeenCalledWith(
        `mouseup`,
        expect.any(Function),
      )
    })
  })
})
