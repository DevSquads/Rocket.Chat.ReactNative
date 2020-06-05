import React from 'react';
import PropTypes from 'prop-types';
import { View, Text, ScrollView } from 'react-native';
import { BorderlessButton } from 'react-native-gesture-handler';
import { connect } from 'react-redux';
import UAParser from 'ua-parser-js';
import _ from 'lodash';

import database from '../../lib/database';
import { CustomIcon } from '../../lib/Icons';
import Status from '../../containers/Status';
import Avatar from '../../containers/Avatar';
import styles from './styles';
import sharedStyles from '../Styles';
import RocketChat from '../../lib/rocketchat';
import RoomTypeIcon from '../../containers/RoomTypeIcon';
import I18n from '../../i18n';
import { CustomHeaderButtons, CloseModalButton } from '../../containers/HeaderButton';
import StatusBar from '../../containers/StatusBar';
import log from '../../utils/log';
import { themes } from '../../constants/colors';
import { withTheme } from '../../theme';
import { getUserSelector } from '../../selectors/login';
import Markdown from '../../containers/markdown';

import Livechat from './Livechat';
import Channel from './Channel';
import Item from './Item';
import Direct from './Direct';
import SafeAreaView from '../../containers/SafeAreaView';
import { goRoom } from '../../utils/goRoom';
import Navigation from '../../lib/Navigation';

const PERMISSION_EDIT_ROOM = 'edit-room';
const getRoomTitle = (room, type, name, username, statusText, theme) => (type === 'd'
	? (
		<>
			<Text testID='room-info-view-name' style={[styles.roomTitle, { color: themes[theme].titleText }]}>{ name }</Text>
			{username && <Text testID='room-info-view-username' style={[styles.roomUsername, { color: themes[theme].auxiliaryText }]}>{`@${ username }`}</Text>}
			{!!statusText && <View testID='room-info-view-custom-status'><Markdown msg={statusText} style={[styles.roomUsername, { color: themes[theme].auxiliaryText }]} preview theme={theme} /></View>}
		</>
	)
	: (
		<View style={styles.roomTitleRow}>
			<RoomTypeIcon type={room.prid ? 'discussion' : room.t} key='room-info-type' status={room.visitor?.status} theme={theme} />
			<Text testID='room-info-view-name' style={[styles.roomTitle, { color: themes[theme].titleText }]} key='room-info-name'>{RocketChat.getRoomTitle(room)}</Text>
		</View>
	)
);

class RoomInfoView extends React.Component {
	static propTypes = {
		navigation: PropTypes.object,
		route: PropTypes.object,
		user: PropTypes.shape({
			id: PropTypes.string,
			token: PropTypes.string
		}),
		baseUrl: PropTypes.string,
		rooms: PropTypes.array,
		theme: PropTypes.string,
		isMasterDetail: PropTypes.bool
	}

	constructor(props) {
		super(props);
		const room = props.route.params?.room;
		const roomUser = props.route.params?.member;
		this.rid = props.route.params?.rid;
		this.t = props.route.params?.t;
		this.state = {
			room: room || { rid: this.rid, t: this.t },
			roomUser: roomUser || {},
			showEdit: false
		};
	}

	componentDidMount() {
		if (this.isDirect) {
			this.loadUser();
		} else {
			this.loadRoom();
		}
		this.setHeader();

		const { navigation } = this.props;
		this.unsubscribeFocus = navigation.addListener('focus', () => {
			if (this.isLivechat) {
				this.loadVisitor();
			}
		});
	}

	componentWillUnmount() {
		if (this.subscription && this.subscription.unsubscribe) {
			this.subscription.unsubscribe();
		}
		if (this.unsubscribeFocus) {
			this.unsubscribeFocus();
		}
	}

	setHeader = () => {
		const { roomUser, room, showEdit } = this.state;
		const { navigation, route } = this.props;
		const t = route.params?.t;
		const rid = route.params?.rid;
		const showCloseModal = route.params?.showCloseModal;
		navigation.setOptions({
			headerLeft: showCloseModal ? () => <CloseModalButton navigation={navigation} /> : undefined,
			title: t === 'd' ? I18n.t('User_Info') : I18n.t('Room_Info'),
			headerRight: showEdit
				? () => (
					<CustomHeaderButtons>
						<Item
							iconName='edit'
							onPress={() => navigation.navigate(t === 'l' ? 'LivechatEditView' : 'RoomInfoEditView', { rid, room, roomUser })}
							testID='room-info-view-edit-button'
						/>
					</CustomHeaderButtons>
				)
				: null
		});
	}

	get isDirect() {
		const { room } = this.state;
		return room.t === 'd';
	}

	get isLivechat() {
		const { room } = this.state;
		return room.t === 'l';
	}

	getRoleDescription = async(id) => {
		const db = database.active;
		try {
			const rolesCollection = db.collections.get('roles');
			const role = await rolesCollection.find(id);
			if (role) {
				return role.description;
			}
			return null;
		} catch (e) {
			return null;
		}
	};

	loadVisitor = async() => {
		const { room } = this.state;
		try {
			const result = await RocketChat.getVisitorInfo(room?.visitor?._id);
			if (result.success) {
				const { visitor } = result;
				if (visitor.userAgent) {
					const ua = new UAParser();
					ua.setUA(visitor.userAgent);
					visitor.os = `${ ua.getOS().name } ${ ua.getOS().version }`;
					visitor.browser = `${ ua.getBrowser().name } ${ ua.getBrowser().version }`;
				}
				this.setState({ roomUser: visitor });
				this.setHeader();
			}
		} catch (error) {
			// Do nothing
		}
	}

	loadUser = async() => {
		const { room: roomState, roomUser } = this.state;

		if (_.isEmpty(roomUser)) {
			try {
				const roomUserId = RocketChat.getUidDirectMessage(roomState);
				const result = await RocketChat.getUserInfo(roomUserId);
				if (result.success) {
					const { user } = result;
					const { roles } = user;
					if (roles && roles.length) {
						user.parsedRoles = await Promise.all(roles.map(async(role) => {
							const description = await this.getRoleDescription(role);
							return description;
						}));
					}

					const room = await this.getDirect(user.username);

					this.setState({ roomUser: user, room: { ...roomState, rid: room.rid } });
				}
			} catch {
				// do nothing
			}
		}
	}

	loadRoom = async() => {
		const { route } = this.props;
		let room = route.params?.room;
		if (room && room.observe) {
			this.roomObservable = room.observe();
			this.subscription = this.roomObservable
				.subscribe((changes) => {
					this.setState({ room: changes });
					this.setHeader();
				});
		} else {
			try {
				const result = await RocketChat.getRoomInfo(this.rid);
				if (result.success) {
					({ room } = result);
					this.setState({ room });
				}
			} catch (e) {
				log(e);
			}
		}

		const permissions = await RocketChat.hasPermission([PERMISSION_EDIT_ROOM], room.rid);
		if (permissions[PERMISSION_EDIT_ROOM] && !room.prid) {
			this.setState({ showEdit: true });
			this.setHeader();
		}
	}

	getDirect = async(username) => {
		try {
			const result = await RocketChat.createDirectMessage(username);
			if (result.success) {
				return result.room;
			}
		} catch {
			// do nothing
		}
	}

	goRoom = () => {
		const { roomUser, room } = this.state;
		const { name, username } = roomUser;
		const { rooms, navigation, isMasterDetail } = this.props;
		const params = {
			rid: room.rid,
			name: RocketChat.getRoomTitle({
				t: room.t,
				fname: name,
				name: username
			}),
			t: room.t,
			roomUserId: RocketChat.getUidDirectMessage(room)
		};

		if (room.rid) {
			// if it's on master detail layout, we close the modal and replace RoomView
			if (isMasterDetail) {
				Navigation.navigate('ChatsDrawer');
				goRoom({ item: params, isMasterDetail });
			} else {
				let navigate = navigation.push;
				// if this is a room focused
				if (rooms.includes(room.rid)) {
					({ navigate } = navigation);
				}
				navigate('RoomView', params);
			}
		}
	}

	videoCall = () => {
		const { room } = this.state;
		RocketChat.callJitsi(room.rid);
	}

	renderAvatar = (room, roomUser) => {
		const { baseUrl, user, theme } = this.props;

		return (
			<Avatar
				text={room.name || roomUser.username}
				size={100}
				style={styles.avatar}
				type={this.t}
				baseUrl={baseUrl}
				userId={user.id}
				token={user.token}
			>
				{this.t === 'd' && roomUser._id ? <Status style={[sharedStyles.status, styles.status]} theme={theme} size={24} id={roomUser._id} /> : null}
			</Avatar>
		);
	}

	renderButton = (onPress, iconName, text) => {
		const { theme } = this.props;
		return (
			<BorderlessButton
				onPress={onPress}
				style={styles.roomButton}
			>
				<CustomIcon
					name={iconName}
					size={30}
					color={themes[theme].actionTintColor}
				/>
				<Text style={[styles.roomButtonText, { color: themes[theme].actionTintColor }]}>{text}</Text>
			</BorderlessButton>
		);
	}

	renderButtons = () => (
		<View style={styles.roomButtonsContainer}>
			{this.renderButton(this.goRoom, 'message', I18n.t('Message'))}
			{this.renderButton(this.videoCall, 'video-1', I18n.t('Video_call'))}
		</View>
	)

	renderContent = () => {
		const { room, roomUser } = this.state;
		const { theme } = this.props;

		if (this.isDirect) {
			return <Direct roomUser={roomUser} theme={theme} />;
		} else if (this.t === 'l') {
			return <Livechat room={room} roomUser={roomUser} theme={theme} />;
		}
		return <Channel room={room} theme={theme} />;
	}

	render() {
		const { room, roomUser } = this.state;
		const { theme } = this.props;
		return (
			<ScrollView style={[styles.scroll, { backgroundColor: themes[theme].backgroundColor }]}>
				<StatusBar theme={theme} />
				<SafeAreaView
					style={{ backgroundColor: themes[theme].backgroundColor }}
					theme={theme}
					testID='room-info-view'
				>
					<View style={[styles.avatarContainer, this.isDirect && styles.avatarContainerDirectRoom, { backgroundColor: themes[theme].auxiliaryBackground }]}>
						{this.renderAvatar(room, roomUser)}
						<View style={styles.roomTitleContainer}>{ getRoomTitle(room, this.t, roomUser?.name, roomUser?.username, roomUser?.statusText, theme) }</View>
						{this.isDirect ? this.renderButtons() : null}
					</View>
					{this.renderContent()}
				</SafeAreaView>
			</ScrollView>
		);
	}
}

const mapStateToProps = state => ({
	baseUrl: state.server.server,
	user: getUserSelector(state),
	rooms: state.room.rooms,
	isMasterDetail: state.app.isMasterDetail
});

export default connect(mapStateToProps)(withTheme(RoomInfoView));
