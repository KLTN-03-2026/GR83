import { classNames } from '../../utils/classNames';

export default function SectionHeading({ title, subtitle, inverse = false }) {
  return (
    <div className={classNames('section-heading', inverse && 'section-heading--inverse')}>
      <p className="section-heading__eyebrow">{subtitle}</p>
      <h2>{title}</h2>
    </div>
  );
}
