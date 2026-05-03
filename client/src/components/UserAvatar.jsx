import { cn } from '../lib/utils';

function fallbackInitials(user) {
  return user?.initials || user?.name?.slice(0, 2).toUpperCase() || 'U';
}

export function UserAvatar({ user, className = '', textClassName = '' }) {
  return (
    <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-tactical-pitch font-black text-white shadow-glow', className)}>
      {user?.avatarDataUrl ? (
        <img src={user.avatarDataUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className={textClassName}>{fallbackInitials(user)}</span>
      )}
    </div>
  );
}
