import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * Height of the on-screen keyboard in dp, or 0 while it is closed.
 *
 * Android draws edge to edge (edgeToEdgeEnabled), so the window is never resized for
 * the keyboard and `KeyboardAvoidingView` has nothing to measure against: a composer
 * pinned to the bottom of the window ends up behind the keyboard. Reading the height
 * from the keyboard events and padding the container explicitly is the part RN does
 * not do for us. The reported height stops at the top of the navigation bar, so a
 * caller lifting content clear of the keyboard adds the bottom safe-area inset too.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
