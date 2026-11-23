import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Animated from 'react-native-reanimated';
import { FloatingOverlay } from './FloatingOverlay';

const MAX_HEIGHT = 240;

interface AgentInputAutocompleteProps {
    suggestions: React.ReactElement[];
    selectedIndex?: number;
    onSelect: (index: number) => void;
    itemHeight: number;
}

export const AgentInputAutocomplete = React.memo((props: AgentInputAutocompleteProps) => {
    const { suggestions, selectedIndex = -1, onSelect, itemHeight } = props;
    const { theme } = useUnistyles();
    const scrollRef = React.useRef<Animated.ScrollView>(null);
    const offsetRef = React.useRef(0);

    // Keep the row picked with the arrow keys inside the visible window.
    React.useEffect(() => {
        if (selectedIndex < 0 || !scrollRef.current) return;
        const top = selectedIndex * itemHeight;
        const bottom = top + itemHeight;
        let target: number | null = null;
        if (top < offsetRef.current) {
            target = top;
        } else if (bottom > offsetRef.current + MAX_HEIGHT) {
            target = bottom - MAX_HEIGHT;
        }
        if (target !== null) {
            offsetRef.current = target;
            scrollRef.current.scrollTo({ y: target, animated: false });
        }
    }, [selectedIndex, itemHeight]);

    if (suggestions.length === 0) {
        return null;
    }

    return (
        <FloatingOverlay
            maxHeight={MAX_HEIGHT}
            keyboardShouldPersistTaps="handled"
            showScrollIndicator
            scrollViewRef={scrollRef}
            onScroll={(y) => { offsetRef.current = y; }}
        >
            {suggestions.map((suggestion, index) => (
                <Pressable
                    key={index}
                    onPress={() => onSelect(index)}
                    style={({ pressed }) => ({
                        height: itemHeight,
                        backgroundColor: pressed
                            ? theme.colors.surfacePressed
                            : selectedIndex === index
                                ? theme.colors.surfaceSelected
                                : 'transparent',
                    })}
                >
                    {suggestion}
                </Pressable>
            ))}
        </FloatingOverlay>
    );
});