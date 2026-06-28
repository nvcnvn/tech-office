'use client';

import { useRef, useCallback, KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react';
import { Box, TextField } from '@mui/material';

interface PinInputBoxesProps {
	value: string;
	onChange: (pin: string) => void;
	disabled?: boolean;
	length?: number;
}

export function PinInputBoxes({ value, onChange, disabled = false, length = 6 }: PinInputBoxesProps) {
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	const digits = value.padEnd(length, '').split('').slice(0, length);

	const focusInput = useCallback((index: number) => {
		if (index >= 0 && index < length) {
			inputRefs.current[index]?.focus();
		}
	}, [length]);

	const handleChange = useCallback((index: number, e: ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value.replace(/\D/g, '');
		if (!val) return;

		// Take only the last typed digit (handles overwrite)
		const digit = val.slice(-1);
		const newDigits = [...digits];
		newDigits[index] = digit;

		const newPin = newDigits.join('').replace(/ /g, '');
		onChange(newPin);

		// Auto-advance to next box
		if (index < length - 1) {
			focusInput(index + 1);
		}
	}, [digits, length, onChange, focusInput]);

	const handleKeyDown = useCallback((index: number, e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Backspace') {
			e.preventDefault();
			const newDigits = [...digits];

			if (digits[index] && digits[index] !== ' ') {
				// Clear current box
				newDigits[index] = ' ';
				onChange(newDigits.join('').trimEnd());
			} else if (index > 0) {
				// Move back and clear previous
				newDigits[index - 1] = ' ';
				onChange(newDigits.join('').trimEnd());
				focusInput(index - 1);
			}
		} else if (e.key === 'ArrowLeft' && index > 0) {
			focusInput(index - 1);
		} else if (e.key === 'ArrowRight' && index < length - 1) {
			focusInput(index + 1);
		}
	}, [digits, length, onChange, focusInput]);

	const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
		if (pasted) {
			onChange(pasted);
			// Focus the box after the last pasted digit
			focusInput(Math.min(pasted.length, length - 1));
		}
	}, [length, onChange, focusInput]);

	return (
		<Box
			sx={{
				display: 'flex',
				gap: 1,
				justifyContent: 'center',
			}}
			data-testid="pin-input-boxes"
		>
			{Array.from({ length }, (_, i) => (
				<TextField
					key={i}
					inputRef={(el) => { inputRefs.current[i] = el; }}
					value={digits[i] === ' ' ? '' : digits[i]}
					onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(i, e)}
					onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(i, e)}
					onPaste={handlePaste}
					disabled={disabled}
					slotProps={{
						input: {
							sx: {
								textAlign: 'center',
								fontSize: '1.5rem',
								fontWeight: 'bold',
								width: 48,
								height: 56,
								p: 0,
							},
						},
						htmlInput: {
							maxLength: 1,
							inputMode: 'numeric',
							pattern: '[0-9]*',
							'data-testid': `pin-box-${i}`,
							style: { textAlign: 'center' },
							autoComplete: 'off',
						},
					}}
					type="password"
					sx={{
						'& .MuiOutlinedInput-root': { width: 48, height: 56 },
					}}
				/>
			))}
		</Box>
	);
}
