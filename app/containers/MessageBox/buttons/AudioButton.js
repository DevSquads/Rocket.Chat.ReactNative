import React from 'react';
import PropTypes from 'prop-types';

import BaseButton from './BaseButton';
import { isAndroid } from '../../../utils/deviceInfo';

const AudioButton = React.memo(({ theme, onPress }) => (
	<BaseButton
		onPress={onPress}
		testID='messagebox-send-audio'
		accessibilityLabel='Send_audio_message'
		icon='mic'
		theme={theme}
		style={isAndroid && { backgroundColor: '#075E54', borderRadius: 30}}
	/>
));

AudioButton.propTypes = {
	theme: PropTypes.string,
	onPress: PropTypes.func.isRequired
};

export default AudioButton;
